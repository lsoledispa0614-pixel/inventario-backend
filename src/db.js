import pkg from "pg";
const { Pool } = pkg;

export const pool = new Pool({
  user: "invent_user",
  host: "localhost",
  database: "inventario",
  password: "1997",
  port: 5432,
});

