import { promises as fs } from "fs";
import path = require("path");

import { AuthUser } from "./types";

type StoredUser = AuthUser & { passwordHash?: string };

const DATA_DIR = path.join(process.cwd(), "data");
const USERS_FILE = "users.json";

async function readUsers(): Promise<StoredUser[]> {
  try {
    const buf = await fs.readFile(path.join(DATA_DIR, USERS_FILE), "utf-8");
    return JSON.parse(buf) as StoredUser[];
  } catch {
    return seedUsers();
  }
}

async function writeUsers(users: StoredUser[]): Promise<void> {
  await fs.mkdir(DATA_DIR, { recursive: true });
  await fs.writeFile(path.join(DATA_DIR, USERS_FILE), JSON.stringify(users, null, 2));
}

async function seedUsers(): Promise<StoredUser[]> {
  const seed: StoredUser[] = [
    {
      userId: "user-1",
      tenantId: "tenant-default",
      email: "admin@example.com",
      roles: ["admin"]
    },
    {
      userId: "user-2",
      tenantId: "tenant-default",
      email: "editor@example.com",
      roles: ["editor"]
    }
  ];
  await writeUsers(seed);
  return seed;
}

export class AuthStoreClient {
  private cache: StoredUser[] | null = null;

  private async load(): Promise<StoredUser[]> {
    if (this.cache) return this.cache;
    this.cache = await readUsers();
    return this.cache;
  }

  async findByEmail(email: string): Promise<AuthUser | undefined> {
    const users = await this.load();
    return users.find((u) => u.email.toLowerCase() === email.toLowerCase());
  }
}


