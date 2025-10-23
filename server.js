import dotenv from "dotenv";
dotenv.config();

// backend/server.js
import express from "express";
import cors from "cors";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";
import pkg from "pg";
const { Pool } = pkg;

const app = express();
app.use(cors());
app.use(express.json());
// ✅ Garante que options e outros campos JSON sempre sejam válidos
const safeParseJSON = (value) => {
  try {
    if (!value || value === '' || value === 'null') return [];
    if (typeof value === 'object') return value; // já é JSON
    return JSON.parse(value);
  } catch {
    return [];
  }
};
const pool = new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false }
});

/*
// ⚙️ Configuração de conexão com PostgreSQL
const pool = new Pool({
  user: "postgres",           // ajuste conforme seu ambiente
  host: "localhost",
  database: "medrecall_db",   // ajuste conforme necessário
  password: "/92230581",      // coloque sua senha real
  port: 5432,
});
*/
// 🔐 Middleware de autenticação JWT
function verifyToken(req, res, next) {
  const authHeader = req.headers["authorization"];
  const token = authHeader && authHeader.split(" ")[1];
  if (!token) return res.status(401).json({ message: "Token ausente" });

  jwt.verify(token, "segredo_medrecall", (err, user) => {
    if (err) return res.status(403).json({ message: "Token inválido" });
    req.user = user;
    next();
  });
}

// 🧾 Registro de usuário
app.post("/api/register", async (req, res) => {
  const { email, password } = req.body;
  try {
    const hashedPassword = await bcrypt.hash(password, 10);
    const result = await pool.query(
      `INSERT INTO users (email, password_hash, subscription_status, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING id, email`,
      [email, hashedPassword, "inactive"]
    );
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("Erro no registro:", err);
    res.status(500).json({ message: "Erro ao registrar usuário." });
  }
});

// 🔐 Login de usuário
app.post("/api/login", async (req, res) => {
  const { email, password } = req.body;
  try {
    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0)
      return res.status(400).json({ message: "Usuário não encontrado." });

    const user = result.rows[0];
    const validPassword = await bcrypt.compare(password, user.password_hash);
    if (!validPassword)
      return res.status(401).json({ message: "Senha incorreta." });

    const token = jwt.sign({ id: user.id }, "segredo_medrecall", { expiresIn: "1h" });
    res.json({
      token,
      user: {
        id: user.id,
        email: user.email,
        subscription_status: user.subscription_status,
      },
    });
  } catch (err) {
    console.error("Erro no login:", err);
    res.status(500).json({ message: "Erro ao fazer login." });
  }
});

// 🚀 Carrega todos os dados do usuário logado
// 🚀 Carrega todos os dados do usuário logado
app.get('/api/initial-data', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    console.log(`📦 Carregando dados do usuário ID: ${userId}`);

    const [folders, decks, flashcards, planners, files] = await Promise.all([
      pool.query('SELECT * FROM folders WHERE user_id = $1 AND deleted_at IS NULL', [userId]),
      pool.query('SELECT * FROM decks WHERE user_id = $1 AND deleted_at IS NULL', [userId]),
      pool.query('SELECT * FROM flashcards WHERE user_id = $1 AND deleted_at IS NULL', [userId]),
      pool.query('SELECT * FROM planners WHERE user_id = $1 AND deleted_at IS NULL', [userId]),
      pool.query('SELECT * FROM files WHERE user_id = $1 AND deleted_at IS NULL', [userId]),
    ]);

    console.log(`📂 Pastas encontradas: ${folders.rows.length}`);
    console.log(`📘 Decks encontrados: ${decks.rows.length}`);
    console.log(`💬 Flashcards encontrados: ${flashcards.rows.length}`);
    console.log(`📅 Planners encontrados: ${planners.rows.length}`);
    console.log(`📁 Files encontrados: ${files.rows.length}`);

    // 🧩 Associa flashcards aos decks correspondentes
    const decksWithCards = decks.rows.map(deck => {
      const cards = flashcards.rows
        .filter(card => Number(card.deck_id) === Number(deck.id))
        .map(card => ({
          id: card.id,
          question: card.front,
          answer: card.back,
          commentary: card.commentary || '',
          type: card.type || 'text',
          options: safeParseJSON(card.options), // ✅ Corrigido aqui
          srsLevel: card.srs_level || 0,
          nextReviewDate: card.next_review_date,
          reviewHistory: []
        }));
      return { ...deck, cards };
    });

    console.log(`✅ Retornando ${decksWithCards.length} decks prontos.`);

    res.json({
      folders: folders.rows,
      decks: decksWithCards,
      flashcards: flashcards.rows,
      planners: planners.rows,
      files: files.rows,
    });
  } catch (err) {
    console.error('❌ Erro ao carregar dados iniciais:', err);
    res.status(500).json({ message: 'Erro ao carregar dados do usuário.', error: err.message });
  }
});


// 🆕 Criar novo deck
// 🆕 Criar novo deck (folder_id ainda NULL)
// 🆕 Criar novo deck (detecta tipo automaticamente)
app.post('/api/decks', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { name, type } = req.body;

    if (!name || !type) {
      return res.status(400).json({ message: 'Nome e tipo são obrigatórios.' });
    }

    const result = await pool.query(
      `INSERT INTO decks (user_id, name, type, created_at, folder_id)
       VALUES ($1, $2, $3, NOW(), NULL)
       RETURNING *`,
      [userId, name, type]
    );

    console.log('✅ Novo deck criado:', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('Erro ao criar deck:', err);
    res.status(500).json({ message: 'Erro ao criar deck.' });
  }
});



// 📦 Listar decks
app.get("/api/decks", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;

    const result = await pool.query(
      `SELECT * FROM decks
       WHERE user_id = $1
       AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [userId]
    );

    res.json(result.rows);
  } catch (err) {
    console.error("Erro ao buscar decks:", err);
    res.status(500).json({ message: "Erro ao buscar decks." });
  }
});

// 🗂️ Criar nova pasta
app.post("/api/folders", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    let { name, type } = req.body;

    if (!name) return res.status(400).json({ message: "Nome da pasta é obrigatório." });
    if (!type || (type !== "flashcards" && type !== "questions")) type = "flashcards";

    const result = await pool.query(
      `INSERT INTO folders (user_id, name, type, created_at)
       VALUES ($1, $2, $3, NOW())
       RETURNING *`,
      [userId, name, type]
    );

    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error("❌ Erro ao criar pasta:", err);
    res.status(500).json({ message: "Erro ao criar pasta." });
  }
});

// 📋 Listar pastas
app.get("/api/folders", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const result = await pool.query(
      `SELECT * FROM folders
       WHERE user_id = $1
       AND deleted_at IS NULL
       ORDER BY created_at DESC`,
      [userId]
    );
    res.json(result.rows);
  } catch (err) {
    console.error("Erro ao buscar pastas:", err);
    res.status(500).json({ message: "Erro ao buscar pastas." });
  }
});

// 🆕 Criar novo flashcard
// 🆕 Criar novo flashcard (com suporte a múltipla escolha e campos opcionais)
app.post('/api/flashcards', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const {
      deck_id,
      front,
      back,
      commentary,
      srs_level,
      type,
      options,
      next_review_date
    } = req.body;

    // ⚠️ Validação básica
    if (!deck_id || !front || !back) {
      return res.status(400).json({ message: 'Campos obrigatórios ausentes.' });
    }

    // ✅ Garante que options seja sempre JSON válido (array mesmo se vier undefined)
    const safeOptions =
      options && Array.isArray(options)
        ? JSON.stringify(options)
        : JSON.stringify([]);

    // ✅ Insere todos os campos relevantes
    const result = await pool.query(
      `INSERT INTO flashcards
        (user_id, deck_id, front, back, commentary, srs_level, type, options, next_review_date, created_at)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, NOW())
       RETURNING *`,
      [
        userId,
        deck_id,
        front,
        back,
        commentary || '',
        srs_level || 0,
        type || 'text',
        safeOptions,
        next_review_date || null
      ]
    );

    console.log('✅ Flashcard criado:', result.rows[0]);
    res.status(201).json(result.rows[0]);
  } catch (err) {
    console.error('❌ Erro ao criar flashcard:', err);
    res.status(500).json({ message: 'Erro ao salvar flashcard no servidor.' });
  }
});



// 🧠 Atualizar flashcard existente
app.put('/api/flashcards/:id', verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    // Campos que podem ser atualizados
    const {
      front,
      back,
      commentary,
      srs_level,
      next_review_date,
      type,
      options,
      image_url,
      answer_image_url
    } = req.body;

    // 🧩 Validação
    if (!front && !back) {
      return res.status(400).json({ message: 'Campos obrigatórios ausentes.' });
    }

    // 🔄 Atualiza o registro
    const result = await pool.query(
      `UPDATE flashcards
       SET front = $1,
           back = $2,
           commentary = $3,
           srs_level = $4,
           next_review_date = $5,
           type = $6,
           options = $7,
           image_url = $8,
           answer_image_url = $9,
           updated_at = NOW()
       WHERE id = $10 AND user_id = $11
       RETURNING *`,
      [
        front || '',
        back || '',
        commentary || '',
        srs_level ?? 0,
        next_review_date || null,
        type || 'text',
        options ? JSON.stringify(options) : null,
        image_url || null,
        answer_image_url || null,
        id,
        userId
      ]
    );

    if (result.rowCount === 0) {
      return res.status(404).json({ message: 'Flashcard não encontrado.' });
    }

    console.log(`✅ Flashcard ${id} atualizado com sucesso.`);
    res.json(result.rows[0]);
  } catch (err) {
    console.error('❌ Erro ao atualizar flashcard:', err.message, err.stack);
    res.status(500).json({ message: 'Erro ao atualizar flashcard no servidor.' });
  }
});


// ❌ Deletar flashcard
app.delete("/api/flashcards/:id", verifyToken, async (req, res) => {
  try {
    const userId = req.user.id;
    const { id } = req.params;

    const result = await pool.query(
      `DELETE FROM flashcards WHERE id = $1 AND user_id = $2 RETURNING id`,
      [id, userId]
    );

    if (result.rows.length === 0)
      return res.status(404).json({ message: "Flashcard não encontrado." });

    res.json({ message: "Flashcard removido com sucesso.", id });
  } catch (err) {
    console.error("Erro ao excluir flashcard:", err);
    res.status(500).json({ message: "Erro ao excluir flashcard." });
  }
});

// 🧪 Rota simples de teste
app.get("/", (req, res) => {
  res.send("✅ API MedRecall rodando");
});

// 🚀 Inicialização do servidor
const PORT = 3000;
app.listen(PORT, () => {
  console.log(`🚀 Servidor rodando em http://localhost:${PORT}`);
});
