import dotenv from "dotenv";
import mongoose from "mongoose";
import bcrypt from "bcryptjs";

dotenv.config({ path: "./.env" });

await mongoose.connect(process.env.MONGO_URI);
console.log("MongoDB connected");

// Inline schema to avoid full app import
const userSchema = new mongoose.Schema({
    fullName: String,
    username: String,
    email: String,
    password: String,
    avatar: String,
    refreshToken: String,
});

const User = mongoose.model("User", userSchema);

// Check if already exists
const existing = await User.findOne({ email: "test@devpilot.com" });
if (existing) {
    console.log("User already exists, deleting...");
    await User.deleteOne({ email: "test@devpilot.com" });
}

const hashed = await bcrypt.hash("Test@1234", 10);
const user = await User.create({
    fullName: "Test User",
    username: "testdevpilot",
    email: "test@devpilot.com",
    password: hashed,
    avatar: "https://ui-avatars.com/api/?name=Test+User",
});

console.log("Test user created:", user.email);
await mongoose.disconnect();
