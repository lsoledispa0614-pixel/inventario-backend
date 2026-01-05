import "dotenv/config";
import express from "express";
import cors from "cors";
import { pool } from "./db.js";
import bcrypt from "bcrypt";
import jwt from "jsonwebtoken";

const app = express();
app.use(cors());
app.use(express.json());

// =====================
//  Middleware JWT
// =====================
function authMiddleware(req, res, next) {
  const authHeader = req.headers.authorization;

  if (!authHeader) {
    return res.status(401).json({ msg: "Token requerido" });
  }

  const token = authHeader.split(" ")[1];

  try {
    const decoded = jwt.verify(token, process.env.JWT_SECRET);
    req.user = decoded; // guardamos info del usuario
    next();
  } catch (error) {
    return res.status(401).json({ msg: "Token inválido o expirado" });
  }
}

// =====================
//  PRUEBA DB
// =====================
app.get("/test-db", async (req, res) => {
  try {
    const result = await pool.query("SELECT NOW()");
    res.json({ ok: true, time: result.rows[0] });
  } catch (error) {
    res.status(500).json({ ok: false, error: error.message });
  }
});

// =====================
//  AUTH REGISTER
// =====================
app.post("/api/auth/register", async (req, res) => {
  try {
    const { name, email, password } = req.body;

    if (!name || !email || !password) {
      return res.status(400).json({ msg: "Todos los campos son obligatorios" });
    }

    const existing = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (existing.rows.length > 0) {
      return res.status(400).json({ msg: "El email ya está registrado" });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const result = await pool.query(
      "INSERT INTO users (name, email, password) VALUES ($1, $2, $3) RETURNING id, name, email, role, created_at",
      [name, email, hashedPassword]
    );

    res.status(201).json({ msg: "Usuario registrado ", user: result.rows[0] });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
//  AUTH LOGIN
// =====================
app.post("/api/auth/login", async (req, res) => {
  try {
    const { email, password } = req.body;

    if (!email || !password) {
      return res.status(400).json({ msg: "Email y contraseña son obligatorios" });
    }

    const result = await pool.query("SELECT * FROM users WHERE email = $1", [email]);
    if (result.rows.length === 0) {
      return res.status(401).json({ msg: "Credenciales incorrectas" });
    }

    const user = result.rows[0];

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ msg: "Credenciales incorrectas" });
    }

    const token = jwt.sign(
      { id: user.id, email: user.email, role: user.role },
      process.env.JWT_SECRET,
      { expiresIn: "2h" }
    );

    res.json({
      msg: "Login exitoso ",
      token,
      user: { id: user.id, name: user.name, email: user.email, role: user.role }
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
//  CRUD CATEGORIES
// =====================
app.get("/api/categories", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query("SELECT * FROM categories ORDER BY id ASC");
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/categories", authMiddleware, async (req, res) => {
  try {
    const { name, description } = req.body;

    if (!name) return res.status(400).json({ msg: "Nombre obligatorio" });

    const result = await pool.query(
      "INSERT INTO categories (name, description) VALUES ($1,$2) RETURNING *",
      [name, description || ""]
    );

    res.status(201).json({ msg: "Categoría creada ", category: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/categories/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description } = req.body;

    const result = await pool.query(
      "UPDATE categories SET name=$1, description=$2 WHERE id=$3 RETURNING *",
      [name, description, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ msg: "Categoría no encontrada" });

    res.json({ msg: "Categoría actualizada ", category: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/categories/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query("DELETE FROM categories WHERE id=$1", [id]);

    if (result.rowCount === 0) return res.status(404).json({ msg: "Categoría no encontrada" });

    res.json({ msg: "Categoría eliminada " });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
//  CRUD PRODUCTS
// =====================

//  1) LISTAR PRODUCTOS (SIEMPRE PRIMERO)
app.get("/api/products", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      ORDER BY p.id ASC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

//  2) REPORTE STOCK BAJO (ANTES DE /:id)
app.get("/api/products/low-stock", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT p.*, c.name AS category_name
      FROM products p
      LEFT JOIN categories c ON p.category_id = c.id
      WHERE p.stock <= p.min_stock
      ORDER BY p.stock ASC
    `);

    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

//  3) CONSULTAR PRODUCTO POR ID (DESPUÉS)
app.get("/api/products/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query("SELECT * FROM products WHERE id = $1", [id]);
    if (result.rows.length === 0) return res.status(404).json({ msg: "Producto no encontrado" });

    res.json(result.rows[0]);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

//  4) CREAR PRODUCTO
app.post("/api/products", authMiddleware, async (req, res) => {
  try {
    const { name, description, price, stock, min_stock, category_id } = req.body;

    if (!name) return res.status(400).json({ msg: "El nombre es obligatorio" });

    const result = await pool.query(
      `INSERT INTO products (name, description, price, stock, min_stock, category_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [name, description || "", price || 0, stock || 0, min_stock || 5, category_id || null]
    );

    res.status(201).json({ msg: "Producto creado ", product: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

//  5) ACTUALIZAR PRODUCTO
app.put("/api/products/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, stock, min_stock, category_id } = req.body;

    const result = await pool.query(
      `UPDATE products
       SET name=$1, description=$2, price=$3, stock=$4, min_stock=$5, category_id=$6
       WHERE id=$7
       RETURNING *`,
      [name, description, price, stock, min_stock, category_id, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ msg: "Producto no encontrado" });

    res.json({ msg: "Producto actualizado ", product: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

//  6) ELIMINAR PRODUCTO
app.delete("/api/products/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query("DELETE FROM products WHERE id=$1", [id]);
    if (result.rowCount === 0) return res.status(404).json({ msg: "Producto no encontrado" });

    res.json({ msg: "Producto eliminado " });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});


app.post("/api/products", authMiddleware, async (req, res) => {
  try {
    const { name, description, price, stock, min_stock, category_id } = req.body;

    if (!name) return res.status(400).json({ msg: "El nombre es obligatorio" });

    const result = await pool.query(
      `INSERT INTO products (name, description, price, stock, min_stock, category_id)
       VALUES ($1,$2,$3,$4,$5,$6)
       RETURNING *`,
      [name, description || "", price || 0, stock || 0, min_stock || 5, category_id || null]
    );

    res.status(201).json({ msg: "Producto creado ", product: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.put("/api/products/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const { name, description, price, stock, min_stock, category_id } = req.body;

    const result = await pool.query(
      `UPDATE products
       SET name=$1, description=$2, price=$3, stock=$4, min_stock=$5, category_id=$6
       WHERE id=$7
       RETURNING *`,
      [name, description, price, stock, min_stock, category_id, id]
    );

    if (result.rows.length === 0) return res.status(404).json({ msg: "Producto no encontrado" });

    res.json({ msg: "Producto actualizado ", product: result.rows[0] });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.delete("/api/products/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;

    const result = await pool.query("DELETE FROM products WHERE id=$1", [id]);
    if (result.rowCount === 0) return res.status(404).json({ msg: "Producto no encontrado" });

    res.json({ msg: "Producto eliminado " });
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
//  MOVEMENTS (IN/OUT + Stock Control)
// =====================
app.get("/api/movements", authMiddleware, async (req, res) => {
  try {
    const result = await pool.query(`
      SELECT m.*, p.name AS product_name, u.name AS user_name
      FROM movements m
      JOIN products p ON m.product_id = p.id
      JOIN users u ON m.user_id = u.id
      ORDER BY m.id DESC
    `);
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.get("/api/movements/product/:id", authMiddleware, async (req, res) => {
  try {
    const { id } = req.params;
    const result = await pool.query(
      "SELECT * FROM movements WHERE product_id=$1 ORDER BY id DESC",
      [id]
    );
    res.json(result.rows);
  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

app.post("/api/movements", authMiddleware, async (req, res) => {
  try {
    const { product_id, type, quantity, reason } = req.body;

    if (!product_id || !type || !quantity) {
      return res.status(400).json({ msg: "product_id, type y quantity son obligatorios" });
    }

    if (quantity <= 0) {
      return res.status(400).json({ msg: "quantity debe ser mayor a 0" });
    }

    // Obtener producto actual
    const productResult = await pool.query("SELECT * FROM products WHERE id=$1", [product_id]);
    if (productResult.rows.length === 0) return res.status(404).json({ msg: "Producto no existe" });

    const product = productResult.rows[0];

    // Control stock
    let newStock = product.stock;
    if (type === "IN") newStock += quantity;
    else if (type === "OUT") {
      if (product.stock < quantity) {
        return res.status(400).json({ msg: "Stock insuficiente " });
      }
      newStock -= quantity;
    } else {
      return res.status(400).json({ msg: "type debe ser IN o OUT" });
    }

    // Insert movimiento
    const movementResult = await pool.query(
      `INSERT INTO movements (product_id, user_id, type, quantity, reason)
       VALUES ($1,$2,$3,$4,$5)
       RETURNING *`,
      [product_id, req.user.id, type, quantity, reason || ""]
    );

    // Update stock
    await pool.query("UPDATE products SET stock=$1 WHERE id=$2", [newStock, product_id]);

    res.status(201).json({
      msg: "Movimiento registrado ",
      movement: movementResult.rows[0],
      newStock
    });

  } catch (error) {
    res.status(500).json({ error: error.message });
  }
});

// =====================
// SERVIDOR
// =====================
app.listen(process.env.PORT || 3000, () => {
  console.log(`Servidor corriendo en http://localhost:${process.env.PORT || 3000}`);
});


