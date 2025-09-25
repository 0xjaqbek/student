// Offline storage service using IndexedDB
class OfflineStorageService {
  constructor() {
    this.dbName = 'LectureTranscriptionPWA';
    this.version = 1;
    this.db = null;
    this.init();
  }

  async init() {
    try {
      this.db = await this.openDB();
    } catch (error) {
      console.error('Failed to initialize offline storage:', error);
    }
  }

  openDB() {
    return new Promise((resolve, reject) => {
      const request = indexedDB.open(this.dbName, this.version);

      request.onerror = () => reject(request.error);
      request.onsuccess = () => resolve(request.result);

      request.onupgradeneeded = (event) => {
        const db = event.target.result;

        // Store for offline transcriptions
        if (!db.objectStoreNames.contains('transcriptions')) {
          const transcriptionsStore = db.createObjectStore('transcriptions', { keyPath: 'lectureId' });
          transcriptionsStore.createIndex('timestamp', 'timestamp', { unique: false });
          transcriptionsStore.createIndex('synced', 'synced', { unique: false });
        }

        // Store for offline lectures
        if (!db.objectStoreNames.contains('lectures')) {
          const lecturesStore = db.createObjectStore('lectures', { keyPath: 'id' });
          lecturesStore.createIndex('timestamp', 'timestamp', { unique: false });
          lecturesStore.createIndex('synced', 'synced', { unique: false });
        }

        // Store for sync queue
        if (!db.objectStoreNames.contains('syncQueue')) {
          const syncStore = db.createObjectStore('syncQueue', { keyPath: 'id', autoIncrement: true });
          syncStore.createIndex('timestamp', 'timestamp', { unique: false });
          syncStore.createIndex('type', 'type', { unique: false });
        }
      };
    });
  }

  // Store transcription data offline
  async storeTranscription(lectureId, data) {
    if (!this.db) await this.init();

    try {
      const transaction = this.db.transaction(['transcriptions'], 'readwrite');
      const store = transaction.objectStore('transcriptions');

      const transcriptionData = {
        lectureId,
        rawText: data.rawText || '',
        correctedText: data.correctedText || '',
        chunks: data.chunks || [],
        timestamp: Date.now(),
        synced: false,
        lastUpdated: new Date().toISOString(),
        createdBy: data.createdBy,
        ...data
      };

      await store.put(transcriptionData);
      console.log('Transcription stored offline:', lectureId);
      return true;
    } catch (error) {
      console.error('Error storing transcription offline:', error);
      return false;
    }
  }

  // Store lecture data offline
  async storeLecture(lectureData) {
    if (!this.db) await this.init();

    try {
      const transaction = this.db.transaction(['lectures'], 'readwrite');
      const store = transaction.objectStore('lectures');

      const offlineLecture = {
        ...lectureData,
        timestamp: Date.now(),
        synced: false
      };

      await store.put(offlineLecture);
      console.log('Lecture stored offline:', lectureData.id);
      return true;
    } catch (error) {
      console.error('Error storing lecture offline:', error);
      return false;
    }
  }

  // Add item to sync queue
  async addToSyncQueue(type, data, lectureId = null) {
    if (!this.db) await this.init();

    try {
      const transaction = this.db.transaction(['syncQueue'], 'readwrite');
      const store = transaction.objectStore('syncQueue');

      const queueItem = {
        type, // 'transcription_update', 'lecture_create', 'transcription_create'
        data,
        lectureId,
        timestamp: Date.now(),
        retries: 0
      };

      await store.add(queueItem);
      console.log('Added to sync queue:', type, lectureId);
      return true;
    } catch (error) {
      console.error('Error adding to sync queue:', error);
      return false;
    }
  }

  // Get all unsynced items
  async getUnsyncedData() {
    if (!this.db) await this.init();

    try {
      const [transcriptions, lectures, syncQueue] = await Promise.all([
        this.getAllFromStore('transcriptions'),
        this.getAllFromStore('lectures'),
        this.getAllFromStore('syncQueue')
      ]);

      return {
        transcriptions: transcriptions.filter(item => !item.synced),
        lectures: lectures.filter(item => !item.synced),
        syncQueue
      };
    } catch (error) {
      console.error('Error getting unsynced data:', error);
      return { transcriptions: [], lectures: [], syncQueue: [] };
    }
  }

  // Get offline transcription
  async getOfflineTranscription(lectureId) {
    if (!this.db) await this.init();

    try {
      const transaction = this.db.transaction(['transcriptions'], 'readonly');
      const store = transaction.objectStore('transcriptions');
      const result = await store.get(lectureId);
      return result || null;
    } catch (error) {
      console.error('Error getting offline transcription:', error);
      return null;
    }
  }

  // Mark items as synced
  async markAsSynced(type, id) {
    if (!this.db) await this.init();

    try {
      const transaction = this.db.transaction([type], 'readwrite');
      const store = transaction.objectStore(type);

      const item = await store.get(id);
      if (item) {
        item.synced = true;
        item.syncedAt = Date.now();
        await store.put(item);
        console.log(`Marked as synced: ${type}/${id}`);
      }
    } catch (error) {
      console.error('Error marking as synced:', error);
    }
  }

  // Remove from sync queue
  async removeFromSyncQueue(id) {
    if (!this.db) await this.init();

    try {
      const transaction = this.db.transaction(['syncQueue'], 'readwrite');
      const store = transaction.objectStore('syncQueue');
      await store.delete(id);
      console.log('Removed from sync queue:', id);
    } catch (error) {
      console.error('Error removing from sync queue:', error);
    }
  }

  // Get all items from a store
  async getAllFromStore(storeName) {
    if (!this.db) await this.init();

    return new Promise((resolve, reject) => {
      const transaction = this.db.transaction([storeName], 'readonly');
      const store = transaction.objectStore(storeName);
      const request = store.getAll();

      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  // Clear synced data (cleanup)
  async clearSyncedData() {
    if (!this.db) await this.init();

    try {
      const stores = ['transcriptions', 'lectures'];

      for (const storeName of stores) {
        const transaction = this.db.transaction([storeName], 'readwrite');
        const store = transaction.objectStore(storeName);
        const syncedIndex = store.index('synced');

        const request = syncedIndex.openCursor(IDBKeyRange.only(true));
        request.onsuccess = (event) => {
          const cursor = event.target.result;
          if (cursor) {
            // Keep data for 7 days after sync
            const sevenDaysAgo = Date.now() - (7 * 24 * 60 * 60 * 1000);
            if (cursor.value.syncedAt < sevenDaysAgo) {
              cursor.delete();
            }
            cursor.continue();
          }
        };
      }
    } catch (error) {
      console.error('Error clearing synced data:', error);
    }
  }

  // Get storage stats
  async getStorageStats() {
    if (!this.db) await this.init();

    try {
      const [transcriptions, lectures, syncQueue] = await Promise.all([
        this.getAllFromStore('transcriptions'),
        this.getAllFromStore('lectures'),
        this.getAllFromStore('syncQueue')
      ]);

      return {
        transcriptions: {
          total: transcriptions.length,
          unsynced: transcriptions.filter(item => !item.synced).length
        },
        lectures: {
          total: lectures.length,
          unsynced: lectures.filter(item => !item.synced).length
        },
        syncQueue: syncQueue.length
      };
    } catch (error) {
      console.error('Error getting storage stats:', error);
      return { transcriptions: { total: 0, unsynced: 0 }, lectures: { total: 0, unsynced: 0 }, syncQueue: 0 };
    }
  }
}

// Create singleton instance
const offlineStorage = new OfflineStorageService();
export default offlineStorage;