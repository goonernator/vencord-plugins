/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { FluxDispatcher, RelationshipStore, UserStore } from "@webpack/common";

const emit = {
    info: (msg: string) => console.log(`%c[AutoMuter]%c ${msg}`, "color: #00ff00; font-weight: bold;", "color: inherit;"),
    warn: (msg: string) => console.warn(`%c[AutoMuter]%c ${msg}`, "color: #ffaa00; font-weight: bold;", "color: inherit;"),
    error: (msg: string) => console.error(`%c[AutoMuter]%c ${msg}`, "color: #ff0000; font-weight: bold;", "color: inherit;")
};

const tag = (msg: string) => `[AutoMuter] ${msg}`;

const settings = definePluginSettings({
    enablePlugin: {
        type: OptionType.BOOLEAN,
        description: "Enable AutoMuter plugin",
        default: true
    },
    friendVolume: {
        type: OptionType.SLIDER,
        description: "Volume level for friends (percentage)",
        default: 75,
        markers: [0, 25, 50, 75, 100],
        stickToMarkers: false
    },
    nonFriendVolume: {
        type: OptionType.SLIDER,
        description: "Volume level for non-friends (percentage)",
        default: 50,
        markers: [0, 25, 50, 75, 100],
        stickToMarkers: false
    },
    enableNoiseDetection: {
        type: OptionType.BOOLEAN,
        description: "Enable automatic muting of loud users",
        default: true
    },
    noiseThreshold: {
        type: OptionType.SLIDER,
        description: "Noise threshold for auto-muting (higher = less sensitive)",
        default: 80,
        markers: [50, 60, 70, 80, 90, 100],
        stickToMarkers: false
    },
    muteDuration: {
        type: OptionType.SLIDER,
        description: "Auto-mute duration in seconds",
        default: 5,
        markers: [1, 3, 5, 10, 30],
        stickToMarkers: false
    }
});

const VoiceStateStore = findByPropsLazy("getVoiceStatesForChannel");
const MediaEngineStore = findByPropsLazy("getLocalVolume", "isDeaf");
const AudioConvert = findByPropsLazy("setLocalVolume");
const MediaEngine = findByPropsLazy("setLocalVolume", "getLocalVolume");

interface VoiceState {
    userId: string;
    channelId: string | null;
    sessionId: string;
    [k: string]: any;
}
interface VoiceStateUpdate { type: string; voiceStates: VoiceState[] }

let processedUsers = new Set<string>();
let mutedUsers = new Map<string, number>(); // userId -> unmute timestamp
let audioLevels = new Map<string, number[]>(); // userId -> recent audio levels
let currentChannelId: string | null = null;

const nameOf = (uid: string) => {
    const user = UserStore.getUser(uid);
    return user?.displayName || user?.username || `User(${uid.slice(-4)})`;
};

// Volume setting function with multiple fallback methods
function setUserVolume(userId: string, volume: number): boolean {
    try {
        const volumeDecimal = volume / 100;
        emit.info(`Setting volume for user ${userId}: ${volume}% (${volumeDecimal})`);
        
        // Method 1: AudioConvert
        if (AudioConvert?.setLocalVolume) {
            AudioConvert.setLocalVolume(userId, volumeDecimal);
        }
        
        // Method 2: MediaEngine direct
        if (MediaEngine?.setLocalVolume) {
            MediaEngine.setLocalVolume(userId, volumeDecimal);
        }
        
        // Verify the volume was set
        const currentVolume = MediaEngineStore?.getLocalVolume?.(userId);
        if (currentVolume !== undefined) {
            const currentPercent = Math.round(currentVolume * 100);
            emit.info(`Volume verification: ${currentPercent}% (target: ${volume}%)`);
            return Math.abs(currentPercent - volume) <= 2; // Allow 2% tolerance
        }
        
        return true;
    } catch (error) {
        emit.error(`Failed to set volume for user ${userId}: ${error}`);
        return false;
    }
}

// Mute/unmute user
function setUserMuted(userId: string, muted: boolean): boolean {
    try {
        emit.info(`${muted ? 'Muting' : 'Unmuting'} user ${userId}`);
        
        if (AudioConvert?.setLocalVolume) {
            AudioConvert.setLocalVolume(userId, muted ? 0 : 1);
        }
        
        if (MediaEngine?.setLocalVolume) {
            MediaEngine.setLocalVolume(userId, muted ? 0 : 1);
        }
        
        return true;
    } catch (error) {
        emit.error(`Failed to ${muted ? 'mute' : 'unmute'} user ${userId}: ${error}`);
        return false;
    }
}

// Check if user is a friend
function isFriend(userId: string): boolean {
    const relationship = RelationshipStore.getRelationshipType(userId);
    return relationship === 1; // 1 = friend
}

// Process user volume based on friend status
function processUser(userId: string): void {
    if (!settings.store.enablePlugin) return;
    if (userId === UserStore.getCurrentUser()?.id) return; // Skip self
    if (processedUsers.has(userId)) return;
    
    const isUserFriend = isFriend(userId);
    const targetVolume = isUserFriend ? settings.store.friendVolume : settings.store.nonFriendVolume;
    
    emit.info(`Processing user ${userId}: ${isUserFriend ? 'friend' : 'non-friend'} -> ${targetVolume}%`);
    
    if (setUserVolume(userId, targetVolume)) {
        processedUsers.add(userId);
        emit.info(`Successfully processed user ${userId}`);
    } else {
        emit.warn(`Failed to process user ${userId}`);
    }
}

// Audio level monitoring for noise detection
function monitorAudioLevel(userId: string, audioLevel: number): void {
    if (!settings.store.enableNoiseDetection) return;
    if (userId === UserStore.getCurrentUser()?.id) return; // Skip self
    
    // Initialize audio level history for user
    if (!audioLevels.has(userId)) {
        audioLevels.set(userId, []);
    }
    
    const levels = audioLevels.get(userId)!;
    levels.push(audioLevel);
    
    // Keep only last 10 samples (about 1 second of data)
    if (levels.length > 10) {
        levels.shift();
    }
    
    // Check if user is consistently loud
    if (levels.length >= 5) {
        const avgLevel = levels.reduce((a, b) => a + b, 0) / levels.length;
        const threshold = settings.store.noiseThreshold;
        
        if (avgLevel > threshold && !mutedUsers.has(userId)) {
            emit.warn(`User ${userId} is too loud (${Math.round(avgLevel)}% > ${threshold}%), auto-muting`);
            
            if (setUserMuted(userId, true)) {
                const unmuteTime = Date.now() + (settings.store.muteDuration * 1000);
                mutedUsers.set(userId, unmuteTime);
                
                // Schedule unmute
                setTimeout(() => {
                    if (mutedUsers.has(userId) && mutedUsers.get(userId) === unmuteTime) {
                        emit.info(`Auto-unmuting user ${userId} after ${settings.store.muteDuration}s`);
                        setUserMuted(userId, false);
                        mutedUsers.delete(userId);
                        // Reapply volume settings
                        processUser(userId);
                    }
                }, settings.store.muteDuration * 1000);
            }
        }
    }
}

// Handle voice state updates (users joining/leaving channels)
function handleVoiceStateUpdate(update: VoiceStateUpdate): void {
    if (!settings.store.enablePlugin) return;
    
    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) return;
    
    const myVoiceState = VoiceStateStore.getVoiceStateForUser(currentUser.id);
    if (!myVoiceState?.channelId) {
        // We're not in a voice channel, clear processed users
        processedUsers.clear();
        mutedUsers.clear();
        audioLevels.clear();
        currentChannelId = null;
        return;
    }
    
    // Check if we changed channels
    if (currentChannelId !== myVoiceState.channelId) {
        emit.info(`Switched to channel ${myVoiceState.channelId}`);
        currentChannelId = myVoiceState.channelId;
        processedUsers.clear();
        mutedUsers.clear();
        audioLevels.clear();
        
        // Process existing users in the new channel
        setTimeout(() => processExistingUsers(), 500);
    }
    
    // Process users in the voice state update
    for (const voiceState of update.voiceStates) {
        if (voiceState.channelId === currentChannelId && voiceState.userId !== currentUser.id) {
            emit.info(`User ${voiceState.userId} joined our channel`);
            setTimeout(() => processUser(voiceState.userId), 100);
        }
    }
}

// Process existing users in the current voice channel
function processExistingUsers(): void {
    if (!settings.store.enablePlugin) return;
    
    const currentUser = UserStore.getCurrentUser();
    if (!currentUser) return;
    
    const myVoiceState = VoiceStateStore.getVoiceStateForUser(currentUser.id);
    if (!myVoiceState?.channelId) return;
    
    const voiceStates = VoiceStateStore.getVoiceStatesForChannel(myVoiceState.channelId);
    if (!voiceStates) return;
    
    emit.info(`Processing ${Object.keys(voiceStates).length} existing users in channel`);
    
    for (const userId of Object.keys(voiceStates)) {
        if (userId !== currentUser.id) {
            setTimeout(() => processUser(userId), Math.random() * 1000); // Stagger processing
        }
    }
}

// Handle relationship changes (friend added/removed)
function handleRelationshipUpdate(): void {
    if (!settings.store.enablePlugin) return;
    
    emit.info("Relationship updated, reprocessing users");
    
    // Clear processed users so they get reprocessed with new relationship status
    processedUsers.clear();
    
    // Reprocess existing users after a short delay
    setTimeout(() => processExistingUsers(), 1000);
}

// Clean up expired mutes
function cleanupExpiredMutes(): void {
    const now = Date.now();
    for (const [userId, unmuteTime] of mutedUsers.entries()) {
        if (now >= unmuteTime) {
            emit.info(`Cleaning up expired mute for user ${userId}`);
            mutedUsers.delete(userId);
            audioLevels.delete(userId);
        }
    }
}

// Periodic cleanup interval
setInterval(cleanupExpiredMutes, 5000); // Every 5 seconds

export default definePlugin({
    name: "AutoMuter",
    description: "Auto-adjust volumes for friends (75%) and non-friends (50%) with noise detection",
    authors: [
        { name: "GoonerSquad", id: 1353611010208038942n },
        { name: "Goonernator", id: 1235702899825311894n }
    ],
    settings,

    patches: [
        // Patch to monitor audio levels for noise detection
        {
            find: "getAudioLevel",
            replacement: [
                {
                    match: /(?<=getAudioLevel\(\i,\i\)\{)/,
                    replace: "const level=arguments[1];if(level>0){$self.monitorAudio(arguments[0],level*100);}"
                }
            ]
        }
    ],

    // Expose monitorAudio function to patches
    monitorAudio(userId: string, level: number) {
        monitorAudioLevel(userId, level);
    },

    start() {
        emit.info(`Starting AutoMuter - Friends: ${settings.store.friendVolume}%, Non-friends: ${settings.store.nonFriendVolume}%`);
        
        FluxDispatcher.subscribe("VOICE_STATE_UPDATES", handleVoiceStateUpdate);
        FluxDispatcher.subscribe("RELATIONSHIP_ADD", handleRelationshipUpdate);
        FluxDispatcher.subscribe("RELATIONSHIP_REMOVE", handleRelationshipUpdate);
        FluxDispatcher.subscribe("RELATIONSHIP_UPDATE", handleRelationshipUpdate);
        
        // Process existing users after a short delay
        setTimeout(() => processExistingUsers(), 1000);
    },

    stop() {
        emit.info("Stopping AutoMuter");
        
        FluxDispatcher.unsubscribe("VOICE_STATE_UPDATES", handleVoiceStateUpdate);
        FluxDispatcher.unsubscribe("RELATIONSHIP_ADD", handleRelationshipUpdate);
        FluxDispatcher.unsubscribe("RELATIONSHIP_REMOVE", handleRelationshipUpdate);
        FluxDispatcher.unsubscribe("RELATIONSHIP_UPDATE", handleRelationshipUpdate);
        
        // Clear all data
        processedUsers.clear();
        mutedUsers.clear();
        audioLevels.clear();
        currentChannelId = null;
    }
});

