/**
 * schemas.ts — Zod schemas for Firebase Realtime Database data structures.
 * Used by FB.getSafe() to validate data at read boundaries.
 */

import { z } from "zod";

export const RoomMetaSchema = z
  .object({
    hostId: z.string(),
    roomName: z.string(),
    isOpen: z.boolean(),
    rounds: z.number(),
    timerMinutes: z.number(),
    status: z.string(),
    createdAt: z.union([z.number(), z.object({})]), // serverTimestamp can be object or number
    currentRound: z.number(),
    currentHotSeatIndex: z.number(),
    hotSeatOrder: z.array(z.string()).default([]),
  })
  .passthrough();

export const PlayerInfoSchema = z
  .object({
    name: z.string().max(16),
    score: z.number(),
    isReady: z.boolean(),
    isOnline: z.boolean(),
    guessChancesLeft: z.number(),
    streak: z.number(),
    lastSeen: z.union([z.number(), z.object({})]),
  })
  .passthrough();

export const HotSeatDataSchema = z
  .object({
    playerId: z.string(),
    playerName: z.string(),
    secretPerson: z.string().optional().default(""),
    startedAt: z.union([z.number(), z.object({})]).optional(),
    round: z.number().optional(),
  })
  .passthrough();

export const QuestionDataSchema = z
  .object({
    askerId: z.string(),
    askerName: z.string(),
    text: z.string(),
    answer: z.enum(["pending", "YES", "NO", "MAYBE"]),
    timestamp: z.union([z.number(), z.object({})]),
  })
  .passthrough();

export const GuessDataSchema = z
  .object({
    guesserId: z.string(),
    guesserName: z.string(),
    guess: z.string(),
    isCorrect: z.boolean().nullable(),
    timestamp: z.union([z.number(), z.object({})]),
  })
  .passthrough();

export type RoomMeta = z.infer<typeof RoomMetaSchema>;
export type PlayerInfo = z.infer<typeof PlayerInfoSchema>;
export type HotSeatData = z.infer<typeof HotSeatDataSchema>;
export type QuestionData = z.infer<typeof QuestionDataSchema>;
export type GuessData = z.infer<typeof GuessDataSchema>;
