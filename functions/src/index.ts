import { onSchedule } from "firebase-functions/v2/scheduler";
import * as admin from "firebase-admin";

admin.initializeApp();

/**
 * Runs every hour to clean up stale rooms from the Realtime Database.
 * A room is considered stale if:
 * 1. It was created more than 2 hours ago.
 * 2. ALL players in the room are offline AND haven't been seen in over 30 minutes.
 */
export const cleanupStaleRooms = onSchedule("every 1 hours", async (event) => {
  const db = admin.database();
  const roomsRef = db.ref("rooms");
  
  const snapshot = await roomsRef.once("value");
  const rooms = snapshot.val();
  
  if (!rooms) {
    console.log("No rooms found to clean up.");
    return;
  }
  
  const now = Date.now();
  const TWO_HOURS_MS = 2 * 60 * 60 * 1000;
  const THIRTY_MINS_MS = 30 * 60 * 1000;
  
  let deletedCount = 0;
  
  for (const [roomId, roomData] of Object.entries(rooms)) {
    const meta = (roomData as any).meta;
    const players = (roomData as any).players || {};
    
    if (!meta || !meta.createdAt) {
      // Malformed room, delete it
      await roomsRef.child(roomId).remove();
      deletedCount++;
      console.log(`Deleted malformed room: ${roomId}`);
      continue;
    }
    
    const createdAt = meta.createdAt;
    
    // Condition 1: Older than 2 hours
    if (now - createdAt > TWO_HOURS_MS) {
      await roomsRef.child(roomId).remove();
      deletedCount++;
      console.log(`Deleted old room (>2 hours): ${roomId}`);
      continue;
    }
    
    // Condition 2: All players offline for > 30 minutes
    const playerEntries = Object.values(players) as any[];
    if (playerEntries.length > 0) {
      const allPlayersOfflineLongTime = playerEntries.every((p: any) => {
        // If they are explicitly offline and haven't been seen in 30 mins
        if (p.isOnline === false && p.lastSeen && (now - p.lastSeen > THIRTY_MINS_MS)) {
            return true;
        }
        // If they don't have lastSeen, consider them stale
        if (!p.lastSeen) return true;
        
        return false;
      });
      
      if (allPlayersOfflineLongTime) {
        await roomsRef.child(roomId).remove();
        deletedCount++;
        console.log(`Deleted abandoned room (all players offline >30m): ${roomId}`);
        continue;
      }
    } else {
        // Empty room, delete it if older than 30 mins
        if (now - createdAt > THIRTY_MINS_MS) {
            await roomsRef.child(roomId).remove();
            deletedCount++;
            console.log(`Deleted empty room (>30m): ${roomId}`);
            continue;
        }
    }
  }
  
  console.log(`Cleanup complete. Deleted ${deletedCount} rooms.`);
});
