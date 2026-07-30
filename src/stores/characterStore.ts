import { create } from "zustand";
import { invoke } from "@tauri-apps/api/core";

export interface CharacterCard {
  id: string;
  bookId: string;
  name: string;
  aliases: string;
  description: string;
  background: string;
  traits: string;
  relationships: string;
  extendedProfile: string;
  adultProfile: string;
  createdAt: string;
  updatedAt: string;
}

export interface CreateCharacterRequest {
  bookId: string;
  name: string;
  aliases?: string;
  description?: string;
  background?: string;
  traits?: string;
  relationships?: string;
  extendedProfile?: string;
  adultProfile?: string;
}

export interface UpdateCharacterRequest {
  id: string;
  name?: string;
  aliases?: string;
  description?: string;
  background?: string;
  traits?: string;
  relationships?: string;
  extendedProfile?: string;
  adultProfile?: string;
}

interface CharacterState {
  characters: CharacterCard[];
  isLoading: boolean;
  loadCharacters: (bookId: string) => Promise<void>;
  createCharacter: (req: CreateCharacterRequest) => Promise<CharacterCard>;
  updateCharacter: (req: UpdateCharacterRequest) => Promise<CharacterCard>;
  deleteCharacter: (id: string) => Promise<void>;
}

export const useCharacterStore = create<CharacterState>((set, get) => ({
  characters: [],
  isLoading: false,

  loadCharacters: async (bookId) => {
    set({ isLoading: true });
    try {
      const characters = await invoke<CharacterCard[]>("list_characters", { bookId: bookId });
      set({ characters });
    } finally {
      set({ isLoading: false });
    }
  },

  createCharacter: async (req) => {
    const character = await invoke<CharacterCard>("create_character", { req });
    if (get().characters[0]?.bookId === req.bookId) {
      await get().loadCharacters(req.bookId);
    }
    return character;
  },

  updateCharacter: async (req) => {
    const character = await invoke<CharacterCard>("update_character", { req });
    set((state) => ({
      characters: state.characters.map((c) => (c.id === character.id ? character : c)),
    }));
    return character;
  },

  deleteCharacter: async (id) => {
    await invoke<void>("delete_character", { id });
    set((state) => ({
      characters: state.characters.filter((c) => c.id !== id),
    }));
  },
}));

export function parseExtendedProfile(json: string): Record<string, string> {
  try {
    const parsed = JSON.parse(json);
    if (typeof parsed === "object" && parsed !== null) {
      const result: Record<string, string> = {};
      for (const [key, value] of Object.entries(parsed)) {
        result[key] = String(value ?? "");
      }
      return result;
    }
  } catch {
    // fall through
  }
  return {};
}

export function stringifyExtendedProfile(profile: Record<string, string>): string {
  return JSON.stringify(profile);
}
