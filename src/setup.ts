// Setup: Load dotenv before anything else
import dotenv from "dotenv";
import path from "path";

const envPath = path.join(process.cwd(), ".env");
console.log("📂 Loading .env from:", envPath);
const result = dotenv.config({ path: envPath });

if (result.error) {
  console.warn("⚠️ Warning loading .env:", result.error.message);
} else {
  console.log("✅ .env loaded successfully");
  if (result.parsed) {
    console.log("📊 Loaded variables:", Object.keys(result.parsed).length);
  }
}
