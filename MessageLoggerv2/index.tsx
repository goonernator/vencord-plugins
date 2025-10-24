/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import "./styles.css";

import { findGroupChildrenByChildId, NavContextMenuPatchCallback } from "@api/ContextMenu";
import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import { getCurrentChannel, getCurrentGuild } from "@utils/discord";
import { ModalCloseButton, ModalContent, ModalHeader, ModalProps, ModalRoot, ModalSize, openModal } from "@utils/modal";
import definePlugin, { OptionType } from "@utils/types";
import { Message, User } from "@vencord/discord-types";
import { findByPropsLazy } from "@webpack";
import { Button, ChannelStore, FluxDispatcher, Menu, React, Text, UserStore, MessageStore } from "@webpack/common";

const MessageActions = findByPropsLazy("deleteMessage", "startEditMessage");

import { LoggerModal } from "./components/LoggerModal";
import { MessageStorage } from "./storage";

// Storage for logged messages
const messageStorage = new MessageStorage();

// Track current user being viewed in logger
let currentLoggedUser: User | null = null;

const settings = definePluginSettings({
    maxMessages: {
        type: OptionType.NUMBER,
        description: "Maximum number of messages to store per user",
        default: 1000,
        min: 100,
        max: 10000
    },
    logImages: {
        type: OptionType.BOOLEAN,
        description: "Log images and attachments",
        default: true
    },
    logStickers: {
        type: OptionType.BOOLEAN,
        description: "Log stickers",
        default: true
    },
    logGifs: {
        type: OptionType.BOOLEAN,
        description: "Log GIFs",
        default: true
    },
    logEmbeds: {
        type: OptionType.BOOLEAN,
        description: "Log message embeds",
        default: true
    },
    logSelfMessages: {
        type: OptionType.BOOLEAN,
        description: "Log your own messages",
        default: false
    }
});

// Context menu patch for user right-click
const userContextPatch: NavContextMenuPatchCallback = (children, { user }) => {
    if (!user || user.bot) return;

    const loggerMenuItem = (
        <Menu.MenuItem
            id="vc-message-logger"
            label="Logger"
            icon={() => (
                <svg width="16" height="16" viewBox="0 0 24 24" fill="currentColor">
                    <path d="M19 3H5c-1.1 0-2 .9-2 2v14c0 1.1.9 2 2 2h14c1.1 0 2-.9 2-2V5c0-1.1-.9-2-2-2zm-5 14H7v-2h7v2zm3-4H7v-2h10v2zm0-4H7V7h10v2z"/>
                </svg>
            )}
            action={() => {
                currentLoggedUser = user;
                openModal(props => <LoggerModal {...props} user={user} messageStorage={messageStorage} />);
            }}
        />
    );

    const group = findGroupChildrenByChildId("devmode-copy-id", children) ?? children;
    group.push(loggerMenuItem);
};

// Message logging function
function logMessage(message: Message, isDeleted = false) {
    if (!message.author || message.author.bot) return;
    
    // Check if we should log self messages
    const currentUserId = UserStore.getCurrentUser()?.id;
    if (!settings.store.logSelfMessages && message.author.id === currentUserId) {
        return;
    }
    
    const shouldLog = (
        message.content ||
        (settings.store.logImages && (message.attachments?.length > 0 || message.embeds?.some(e => e.image || e.thumbnail))) ||
        (settings.store.logStickers && message.sticker_items?.length > 0) ||
        (settings.store.logGifs && message.attachments?.some(a => a.content_type?.startsWith('image/gif'))) ||
        (settings.store.logEmbeds && message.embeds?.length > 0) ||
        isDeleted // Always log deleted messages regardless of content
    );

    if (shouldLog) {
        messageStorage.addMessage(message.author.id, {
            id: message.id,
            content: message.content,
            timestamp: message.timestamp,
            author: {
                id: message.author.id,
                username: message.author.username,
                globalName: message.author.globalName,
                avatar: message.author.avatar
            },
            attachments: message.attachments || [],
            embeds: message.embeds || [],
            sticker_items: message.sticker_items || [],
            channel_id: message.channel_id,
            guild_id: getCurrentGuild()?.id || null,
            edited_timestamp: message.edited_timestamp,
            deleted: isDeleted,
            deleted_timestamp: isDeleted ? new Date().toISOString() : undefined
        });
    }
}

export default definePlugin({
    name: "MessageLoggerv2",
    description: "Logs messages, images, attachments, stickers, and GIFs with a custom UI accessible via user context menu",
    authors: [Devs.Ven], // Replace with actual author
    settings,

    contextMenus: {
        "user-context": userContextPatch
    },

    patches: [
        {
            find: "MESSAGE_CREATE:",
            replacement: {
                match: /(MESSAGE_CREATE:function\(\i\)\{)/,
                replace: "$1$self.onMessage(arguments[0]);"
            }
        },
        {
            find: "MESSAGE_UPDATE:",
            replacement: {
                match: /(MESSAGE_UPDATE:function\(\i\)\{)/,
                replace: "$1$self.onMessageUpdate(arguments[0]);"
            }
        },
        {
            // Handle MESSAGE_DELETE to log deleted messages and mark them as deleted
            find: '"MessageStore"',
            replacement: {
                match: /function (?=.+?MESSAGE_DELETE:(\i))\1\((\i)\)\{let.+?((?:\i\.){2})getOrCreate.+?\}(?=function)/,
                replace: "function $1($2){" +
                    "   var cache = $3getOrCreate($2.channelId);" +
                    "   cache = $self.handleDelete(cache, $2, false);" +
                    "   $3commit(cache);" +
                    "}"
            }
        },
        {
            // Handle MESSAGE_DELETE_BULK
            find: '"MessageStore"',
            replacement: {
                match: /function (?=.+?MESSAGE_DELETE_BULK:(\i))\1\((\i)\)\{let.+?((?:\i\.){2})getOrCreate.+?\}(?=function)/,
                replace: "function $1($2){" +
                    "   var cache = $3getOrCreate($2.channelId);" +
                    "   cache = $self.handleDelete(cache, $2, true);" +
                    "   $3commit(cache);" +
                    "}"
            }
        },
        {
            // Add deleted property to message domain model
            find: "}addReaction(",
            replacement: {
                match: /this\.customRenderedContent=(\i)\.customRenderedContent,/,
                replace: "this.customRenderedContent = $1.customRenderedContent," +
                    "this.deleted = $1.deleted || false,"
            }
        },
        {
            // Show deleted messages in chat with visual indicator
            find: "Message must not be a thread starter message",
            replacement: {
                match: /\)\("li",\{(.+?),className:/,
                replace: ")(\"li\",{$1,className:(arguments[0].message.deleted ? \"messagelogger-deleted \" : \"\")+(arguments[0].message.deleted ? \"messagelogger-deleted-message \" : \"\")+(arguments[0].message.deleted && arguments[0].message.content ? \"\" : \"messagelogger-deleted-no-content \")+"
            }
        },
        {
            // Prevent deleted messages from being removed from ReferencedMessageStore
            find: '"ReferencedMessageStore"',
            replacement: [
                {
                    match: /MESSAGE_DELETE:\i,/,
                    replace: "MESSAGE_DELETE:()=>{},"
                },
                {
                    match: /MESSAGE_DELETE_BULK:\i,/,
                    replace: "MESSAGE_DELETE_BULK:()=>{},"
                }
            ]
        },
        {
            // Add deleted message content replacement
            find: "THREAD_STARTER_MESSAGE?null==",
            replacement: {
                match: /(?<=null!=\i\.edited_timestamp\)return )\i\(\i,\{reactions:(\i)\.reactions.{0,50}\}\)/,
                replace: "Object.assign($&,{ deleted:$1.deleted })"
            }
        }
    ],

    onMessage(data: { message: Message }) {
        logMessage(data.message);
    },

    onMessageUpdate(data: { message: Message }) {
        if (data.message.edited_timestamp) {
            logMessage(data.message);
        }
    },

    handleDelete(cache: any, data: { ids?: string[], id?: string; channelId: string }, isBulk: boolean) {
        try {
            const ids = isBulk ? data.ids : [data.id];
            if (!ids) return cache;

            for (const id of ids) {
                const message = MessageStore.getMessage(data.channelId, id);
                if (message && !message.author?.bot) {
                    // Log the message as deleted
                    logMessage(message, true);
                    
                    // Mark message as deleted in the cache
                    cache = cache.update(id, (m: any) => {
                        if (m) {
                            return m.set('deleted', true);
                        }
                        return m;
                    });
                }
            }
        } catch (e) {
            console.error("MessageLoggerv2: Error in handleDelete:", e);
        }
        return cache;
    },

    start() {
        console.log("MessageLoggerv2 started");
        this.restoreMessagesToChat();
    },

    restoreMessagesToChat() {
        try {
            // Set up a listener for when channels are loaded
            this.setupChannelLoadListener();
            
            // Restore messages for the current channel if available
            const currentChannel = getCurrentChannel();
            if (currentChannel) {
                this.restoreChannelMessages(currentChannel.id);
            }
        } catch (error) {
            console.error("Failed to setup message restoration:", error);
        }
    },

    setupChannelLoadListener() {
        // Store the subscription for cleanup
        this.channelSelectSubscription = (data: { channelId: string }) => {
            if (data.channelId) {
                // Small delay to ensure the channel is loaded
                setTimeout(() => this.restoreChannelMessages(data.channelId), 100);
            }
        };
        
        // Listen for channel switches to restore messages
        FluxDispatcher.subscribe("CHANNEL_SELECT", this.channelSelectSubscription);
    },

    restoreChannelMessages(channelId: string) {
        try {
            const deletedMessages = messageStorage.getMessagesByChannel(channelId)
                .filter(msg => msg.deleted);
            
            for (const loggedMessage of deletedMessages) {
                const channelMessages = MessageStore.getMessages(channelId);
                if (channelMessages && !channelMessages.get(loggedMessage.id)) {
                    // Create a message object that matches Discord's format
                    const restoredMessage = {
                        id: loggedMessage.id,
                        content: loggedMessage.content,
                        timestamp: loggedMessage.timestamp,
                        author: loggedMessage.author,
                        attachments: loggedMessage.attachments || [],
                        embeds: loggedMessage.embeds || [],
                        sticker_items: loggedMessage.sticker_items || [],
                        channel_id: loggedMessage.channel_id,
                        guild_id: loggedMessage.guild_id,
                        edited_timestamp: loggedMessage.edited_timestamp,
                        deleted: true,
                        deleted_timestamp: loggedMessage.deleted_timestamp,
                        type: 0, // Default message type
                        flags: 0,
                        pinned: false,
                        tts: false,
                        mention_everyone: false,
                        mentions: [],
                        mention_roles: [],
                        reactions: []
                    };
                    
                    // Add the message back to the store without triggering events
                    const cache = MessageStore._getOrCreateMessageCache(channelId);
                    if (cache && cache.set) {
                        cache.set(loggedMessage.id, restoredMessage);
                    }
                }
            }
        } catch (error) {
            console.error(`Failed to restore messages for channel ${channelId}:`, error);
        }
    },

    async cleanDMMessages(targetUserId: string) {
        try {
            const currentUserId = UserStore.getCurrentUser()?.id;
            if (!currentUserId) return false;

            // Clean from logged messages first
            await messageStorage.cleanDMMessages(targetUserId, currentUserId);

            // Find DM channel with target user using ChannelStore
            const dmChannel = ChannelStore.getSortedPrivateChannels()
                .find(channel => 
                    channel.isDM() && 
                    channel.recipients.includes(targetUserId)
                );

            if (dmChannel) {
                // Get messages from the DM channel
                const messageCache = MessageStore.getMessages(dmChannel.id);
                if (messageCache) {
                    const messagesToDelete = [];
                    messageCache.forEach((message: Message) => {
                        if (message.author.id === currentUserId) {
                            messagesToDelete.push(message.id);
                        }
                    });

                    // Delete messages from Discord's servers with delay to prevent skipping
                    console.log(`[MessageLoggerv2] Found ${messagesToDelete.length} messages to delete`);
                    let deletedCount = 0;
                    for (const messageId of messagesToDelete) {
                        try {
                            await MessageActions.deleteMessage(dmChannel.id, messageId);
                            deletedCount++;
                            console.log(`[MessageLoggerv2] Deleted message ${deletedCount}/${messagesToDelete.length}: ${messageId}`);
                            // Add small delay to prevent rate limiting and ensure proper processing
                            await new Promise(resolve => setTimeout(resolve, 100));
                        } catch (error) {
                            console.error(`[MessageLoggerv2] Failed to delete message ${messageId}:`, error);
                        }
                    }
                    console.log(`[MessageLoggerv2] Successfully deleted ${deletedCount} out of ${messagesToDelete.length} messages`);
                }
            }

            return true;
        } catch (error) {
            console.error("[MessageLoggerv2] Error cleaning DM messages:", error);
            return false;
        }
    },

    stop() {
        console.log("MessageLoggerv2 stopped");
        // Clean up the channel load listener
        if (this.channelSelectSubscription) {
            FluxDispatcher.unsubscribe("CHANNEL_SELECT", this.channelSelectSubscription);
        }
    }
});