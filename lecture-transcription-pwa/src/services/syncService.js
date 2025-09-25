import { doc, setDoc, updateDoc, addDoc, collection, serverTimestamp } from 'firebase/firestore';
import { db } from '../firebase';
import offlineStorage from './offlineStorage';

class SyncService {
  constructor() {
    this.issyncing = false;
    this.syncListeners = [];
  }

  // Add sync listener
  addSyncListener(callback) {
    this.syncListeners.push(callback);
  }

  // Remove sync listener
  removeSyncListener(callback) {
    this.syncListeners = this.syncListeners.filter(cb => cb !== callback);
  }

  // Notify sync listeners
  notifySyncListeners(event, data = null) {
    this.syncListeners.forEach(callback => {
      try {
        callback(event, data);
      } catch (error) {
        console.error('Error in sync listener:', error);
      }
    });
  }

  // Main sync function
  async syncOfflineData() {
    if (this.issyncing) {
      console.log('Sync already in progress');
      return;
    }

    this.issyncing = true;
    this.notifySyncListeners('sync_start');

    try {
      const unsyncedData = await offlineStorage.getUnsyncedData();
      console.log('Unsynced data found:', unsyncedData);

      let syncedCount = 0;
      let errorCount = 0;

      // Sync lectures first
      for (const lecture of unsyncedData.lectures) {
        try {
          await this.syncLecture(lecture);
          await offlineStorage.markAsSynced('lectures', lecture.id);
          syncedCount++;
        } catch (error) {
          console.error('Error syncing lecture:', lecture.id, error);
          errorCount++;
        }
      }

      // Sync transcriptions
      for (const transcription of unsyncedData.transcriptions) {
        try {
          await this.syncTranscription(transcription);
          await offlineStorage.markAsSynced('transcriptions', transcription.lectureId);
          syncedCount++;
        } catch (error) {
          console.error('Error syncing transcription:', transcription.lectureId, error);
          errorCount++;
        }
      }

      // Process sync queue
      for (const queueItem of unsyncedData.syncQueue) {
        try {
          await this.processSyncQueueItem(queueItem);
          await offlineStorage.removeFromSyncQueue(queueItem.id);
          syncedCount++;
        } catch (error) {
          console.error('Error processing sync queue item:', queueItem.id, error);
          errorCount++;

          // Update retry count
          queueItem.retries = (queueItem.retries || 0) + 1;
          if (queueItem.retries >= 3) {
            console.error('Max retries reached for sync queue item:', queueItem.id);
            await offlineStorage.removeFromSyncQueue(queueItem.id);
          }
        }
      }

      this.notifySyncListeners('sync_complete', {
        synced: syncedCount,
        errors: errorCount,
        total: unsyncedData.lectures.length + unsyncedData.transcriptions.length + unsyncedData.syncQueue.length
      });

      console.log(`Sync completed: ${syncedCount} synced, ${errorCount} errors`);

    } catch (error) {
      console.error('Sync error:', error);
      this.notifySyncListeners('sync_error', error);
    } finally {
      this.issyncing = false;
    }
  }

  // Sync a lecture to Firebase
  async syncLecture(lecture) {
    console.log('Syncing lecture:', lecture.id);

    if (lecture.id.startsWith('offline_')) {
      // This is a new lecture created offline
      const lectureData = {
        name: lecture.name,
        topic: lecture.topic,
        createdBy: lecture.createdBy,
        createdByName: lecture.createdByName,
        createdAt: serverTimestamp(),
        isPublic: lecture.isPublic
      };

      const docRef = await addDoc(collection(db, 'lectures'), lectureData);
      console.log('New lecture synced with ID:', docRef.id);

      // Update any related transcriptions with the new ID
      const offlineTranscription = await offlineStorage.getOfflineTranscription(lecture.id);
      if (offlineTranscription) {
        offlineTranscription.lectureId = docRef.id;
        await offlineStorage.storeTranscription(docRef.id, offlineTranscription);
      }

    } else {
      // Update existing lecture
      await updateDoc(doc(db, 'lectures', lecture.id), {
        name: lecture.name,
        topic: lecture.topic,
        lastUpdated: serverTimestamp()
      });
      console.log('Lecture updated:', lecture.id);
    }
  }

  // Sync a transcription to Firebase
  async syncTranscription(transcription) {
    console.log('Syncing transcription:', transcription.lectureId);

    const transcriptionDoc = doc(db, 'transcriptions', transcription.lectureId);
    const updateData = {
      rawText: transcription.rawText || '',
      lastUpdated: serverTimestamp()
    };

    if (transcription.chunks) {
      updateData.chunks = transcription.chunks;
    }

    if (transcription.correctedText) {
      updateData.correctedText = transcription.correctedText;
      updateData.correctedBy = transcription.correctedBy;
      updateData.correctedByName = transcription.correctedByName;
      updateData.correctedAt = transcription.correctedAt ? new Date(transcription.correctedAt) : serverTimestamp();
    }

    if (transcription.createdBy && !transcription.synced) {
      // First time sync
      updateData.createdBy = transcription.createdBy;
      updateData.createdAt = serverTimestamp();
    }

    await setDoc(transcriptionDoc, updateData, { merge: true });
    console.log('Transcription synced:', transcription.lectureId);
  }

  // Process sync queue items
  async processSyncQueueItem(queueItem) {
    console.log('Processing sync queue item:', queueItem.type, queueItem.lectureId);

    switch (queueItem.type) {
      case 'transcription_update':
        await this.syncTranscription({
          lectureId: queueItem.lectureId,
          ...queueItem.data
        });
        break;

      case 'lecture_create':
        await this.syncLecture(queueItem.data);
        break;

      case 'transcription_create':
        await this.syncTranscription({
          lectureId: queueItem.lectureId,
          ...queueItem.data
        });
        break;

      default:
        console.warn('Unknown sync queue item type:', queueItem.type);
    }
  }

  // Store data offline and queue for sync
  async storeOfflineTranscription(lectureId, transcriptionData, userId) {
    try {
      // Store in offline storage
      await offlineStorage.storeTranscription(lectureId, {
        ...transcriptionData,
        createdBy: userId
      });

      // Add to sync queue
      await offlineStorage.addToSyncQueue('transcription_update', transcriptionData, lectureId);

      console.log('Transcription stored offline and queued for sync:', lectureId);
      return true;
    } catch (error) {
      console.error('Error storing offline transcription:', error);
      return false;
    }
  }

  // Store lecture offline
  async storeOfflineLecture(lectureData, userId) {
    try {
      const offlineId = `offline_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`;
      const offlineLecture = {
        ...lectureData,
        id: offlineId,
        createdBy: userId
      };

      await offlineStorage.storeLecture(offlineLecture);
      await offlineStorage.addToSyncQueue('lecture_create', offlineLecture);

      console.log('Lecture stored offline:', offlineId);
      return offlineId;
    } catch (error) {
      console.error('Error storing offline lecture:', error);
      return null;
    }
  }

  // Auto-sync when coming online
  async autoSync() {
    if (navigator.onLine && !this.issyncing) {
      const stats = await offlineStorage.getStorageStats();
      const hasUnsyncedData = stats.transcriptions.unsynced > 0 ||
                             stats.lectures.unsynced > 0 ||
                             stats.syncQueue > 0;

      if (hasUnsyncedData) {
        console.log('Auto-syncing offline data...');
        await this.syncOfflineData();
      }
    }
  }

  // Get sync status
  async getSyncStatus() {
    const stats = await offlineStorage.getStorageStats();
    return {
      issyncing: this.issyncing,
      pendingSync: stats.transcriptions.unsynced + stats.lectures.unsynced + stats.syncQueue,
      stats
    };
  }
}

// Create singleton instance
const syncService = new SyncService();
export default syncService;