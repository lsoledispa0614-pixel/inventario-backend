import pkg from "pg";
const { Pool } = pkg;

export const pool = new Pool({
  user: "invent_user",
  host: "localhost",
  database: "inventario",
  password: "12345",
  port: 5432,
});

