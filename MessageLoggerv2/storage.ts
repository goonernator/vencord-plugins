/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

export interface LoggedMessage {
    id: string;
    content: string;
    timestamp: string;
    author: {
        id: string;
        username: string;
        globalName?: string;
        avatar?: string;
    };
    attachments: any[];
    embeds: any[];
    sticker_items: any[];
    channel_id: string;
    guild_id: string | null;
    edited_timestamp?: string;
    deleted?: boolean;
    deleted_timestamp?: string;
}

export interface UserMessageLog {
    userId: string;
    messages: LoggedMessage[];
    lastUpdated: number;
}

export class MessageStorage {
    private storage: Map<string, UserMessageLog> = new Map();
    private readonly maxMessagesPerUser = 1000;

    constructor() {
        this.loadFromLocalStorage();
    }

    addMessage(userId: string, message: LoggedMessage) {
        let userLog = this.storage.get(userId);
        
        if (!userLog) {
            userLog = {
                userId,
                messages: [],
                lastUpdated: Date.now()
            };
            this.storage.set(userId, userLog);
        }

        // Check if message already exists (to handle edits)
        const existingIndex = userLog.messages.findIndex(m => m.id === message.id);
        if (existingIndex !== -1) {
            userLog.messages[existingIndex] = message;
        } else {
            userLog.messages.unshift(message); // Add to beginning for chronological order
        }

        // Limit messages per user
        if (userLog.messages.length > this.maxMessagesPerUser) {
            userLog.messages = userLog.messages.slice(0, this.maxMessagesPerUser);
        }

        userLog.lastUpdated = Date.now();
        this.saveToLocalStorage();
    }

    getMessages(userId: string): LoggedMessage[] {
        const userLog = this.storage.get(userId);
        return userLog ? userLog.messages : [];
    }

    getUserLogs(): UserMessageLog[] {
        return Array.from(this.storage.values())
            .sort((a, b) => b.lastUpdated - a.lastUpdated);
    }

    clearMessages(userId: string) {
        this.storage.delete(userId);
        this.saveToLocalStorage();
    }

    clearAllMessages() {
        this.storage.clear();
        this.saveToLocalStorage();
    }

    cleanDMMessages(targetUserId: string, currentUserId: string) {
        // Clean from logged messages first
        const userLog = this.storage.get(targetUserId);
        if (userLog) {
            userLog.messages = userLog.messages.filter(message => {
                const isFromCurrentUser = message.author.id === currentUserId;
                const isDM = message.guild_id === null;
                return !(isFromCurrentUser && isDM);
            });
            userLog.lastUpdated = Date.now();
        }
        
        this.saveToLocalStorage();
        
        // Return a promise to indicate completion
        return Promise.resolve();
    }

    getMessageCount(userId: string): number {
        const userLog = this.storage.get(userId);
        return userLog ? userLog.messages.length : 0;
    }

    searchMessages(userId: string, query: string): LoggedMessage[] {
        const messages = this.getMessages(userId);
        if (!query.trim()) return messages;

        const lowerQuery = query.toLowerCase();
        return messages.filter(message => 
            message.content.toLowerCase().includes(lowerQuery) ||
            message.author.username.toLowerCase().includes(lowerQuery) ||
            message.author.globalName?.toLowerCase().includes(lowerQuery)
        );
    }

    getAllMessages(): LoggedMessage[] {
        const allMessages: LoggedMessage[] = [];
        for (const userLog of this.storage.values()) {
            allMessages.push(...userLog.messages);
        }
        return allMessages;
    }

    getMessagesByChannel(channelId: string): LoggedMessage[] {
        const channelMessages: LoggedMessage[] = [];
        for (const userLog of this.storage.values()) {
            const messages = userLog.messages.filter(msg => msg.channel_id === channelId);
            channelMessages.push(...messages);
        }
        // Sort by timestamp to maintain chronological order
        return channelMessages.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());
    }

    private saveToLocalStorage() {
        try {
            const data = Array.from(this.storage.entries());
            localStorage.setItem('vencord-message-logger-v2', JSON.stringify(data));
        } catch (error) {
            console.error('Failed to save message logs to localStorage:', error);
        }
    }

    private loadFromLocalStorage() {
        try {
            const data = localStorage.getItem('vencord-message-logger-v2');
            if (data) {
                const parsed = JSON.parse(data);
                this.storage = new Map(parsed);
            }
        } catch (error) {
            console.error('Failed to load message logs from localStorage:', error);
            this.storage = new Map();
        }
    }

    exportData(): string {
        return JSON.stringify(Array.from(this.storage.entries()), null, 2);
    }

    importData(jsonData: string): boolean {
        try {
            const data = JSON.parse(jsonData);
            this.storage = new Map(data);
            this.saveToLocalStorage();
            return true;
        } catch (error) {
            console.error('Failed to import data:', error);
            return false;
        }
    }
}