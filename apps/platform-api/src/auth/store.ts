import { AuthUser } from "./types";
import { AuthStoreClient } from "./storeClient";

const client = new AuthStoreClient();

export async function findUserByEmail(email: string): Promise<AuthUser | undefined> {
  return client.findByEmail(email);
}

export async function findUserByClerkId(clerkId: string): Promise<AuthUser | undefined> {
  return client.findByClerkId(clerkId);
}
