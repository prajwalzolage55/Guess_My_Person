export interface PlayerInfo {
  name: string;
  score: number;
  isReady: boolean;
  isOnline: boolean;
  guessChancesLeft: number;
  streak: number;
  lastSeen: number;
}

export type RoomCategory = "Celebrities" | "Fictional Characters" | "Athletes" | "Historical Figures" | "Free for all";

export interface RoomMeta {
  hostId: string;
  roomName: string;
  isOpen: boolean;
  rounds: number;
  timerMinutes: number;
  status: string;
  createdAt: number;
  currentRound: number;
  currentHotSeatIndex: number;
  hotSeatOrder: string[];
  category?: RoomCategory;
}

export interface SpectatorInfo {
  name: string;
  joinedAt: number;
}

export interface HotSeatData {
  currentPersonHash: string;
  phase: "entering" | "questioning" | "guessed" | "timeout" | "waiting";
  timerEnd: number;
  secretPerson?: string;
}

export interface QuestionData {
  askerId: string;
  askerName: string;
  text: string;
  answer: "pending" | "YES" | "NO" | "MAYBE";
  timestamp: number;
}

export interface GuessData {
  guesserId: string;
  guesserName: string;
  guess: string;
  isCorrect: boolean | null;
  timestamp: number;
}

export interface FeedItem {
  id: string;
  type: "question" | "guess";
  timestamp: number;
  askerId?: string;
  askerName?: string;
  text?: string;
  answer?: "pending" | "YES" | "NO" | "MAYBE";
  guesserId?: string;
  guesserName?: string;
  guess?: string;
  isCorrect?: boolean | null;
}
