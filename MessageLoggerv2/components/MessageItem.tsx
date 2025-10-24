/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, Text } from "@webpack/common";

import { LoggedMessage } from "../storage";

interface MessageItemProps {
    message: LoggedMessage;
}

export function MessageItem({ message }: MessageItemProps) {
    const formatTimestamp = (timestamp: string) => {
        const date = new Date(timestamp);
        return date.toLocaleString();
    };

    const getMessageStatus = () => {
        if (message.deleted) {
            return {
                label: "DELETED",
                className: "messagelogger-status-deleted",
                timestamp: message.deleted_timestamp
            };
        }
        if (message.edited_timestamp) {
            return {
                label: "EDITED",
                className: "messagelogger-status-edited",
                timestamp: message.edited_timestamp
            };
        }
        return null;
    };

    const status = getMessageStatus();

    const getAvatarUrl = (avatar?: string) => {
        if (!avatar) return "https://cdn.discordapp.com/embed/avatars/0.png";
        return `https://cdn.discordapp.com/avatars/${message.author.id}/${avatar}.${avatar.startsWith('a_') ? 'gif' : 'png'}?size=32`;
    };

    const renderAttachments = () => {
        if (!message.attachments || message.attachments.length === 0) return null;

        return (
            <div className="messagelogger-attachments">
                {message.attachments.map((attachment, index) => (
                    <div key={index} className="messagelogger-attachment">
                        {attachment.content_type?.startsWith('image/') ? (
                            <img 
                                src={attachment.url || attachment.proxy_url}
                                alt={attachment.filename}
                                className="messagelogger-image"
                                onClick={() => window.open(attachment.url || attachment.proxy_url, '_blank')}
                            />
                        ) : (
                            <div 
                                className="messagelogger-file"
                                onClick={() => window.open(attachment.url || attachment.proxy_url, '_blank')}
                            >
                                <span className="messagelogger-file-icon">📎</span>
                                <Text variant="text-sm/normal" className="messagelogger-file-info">
                                    {attachment.filename} ({(attachment.size / 1024).toFixed(1)} KB)
                                </Text>
                            </div>
                        )}
                    </div>
                ))}
            </div>
        );
    };

    const renderStickers = () => {
        if (!message.sticker_items || message.sticker_items.length === 0) return null;

        return (
            <div className="messagelogger-stickers">
                {message.sticker_items.map((sticker, index) => (
                    <div key={index} className="messagelogger-sticker">
                        <img 
                            src={`https://media.discordapp.net/stickers/${sticker.id}.${sticker.format_type === 1 ? 'png' : sticker.format_type === 2 ? 'png' : 'gif'}?size=160`}
                            alt={sticker.name}
                            className="messagelogger-sticker-image"
                        />
                        <Text variant="text-xs/normal" className="messagelogger-sticker-name">
                            Sticker: {sticker.name}
                        </Text>
                    </div>
                ))}
            </div>
        );
    };

    const renderEmbeds = () => {
        if (!message.embeds || message.embeds.length === 0) return null;

        return (
            <div className="messagelogger-embeds">
                {message.embeds.map((embed, index) => (
                    <div 
                        key={index} 
                        className="messagelogger-embed"
                        style={{ 
                            borderLeftColor: embed.color ? `#${embed.color.toString(16).padStart(6, '0')}` : '#5865F2'
                        }}
                    >
                        {embed.title && (
                            <Text variant="text-md/semibold" className="messagelogger-embed-title">
                                {embed.url ? (
                                    <a href={embed.url} target="_blank" rel="noopener noreferrer" style={{ color: "var(--text-link)" }}>
                                        {embed.title}
                                    </a>
                                ) : embed.title}
                            </Text>
                        )}
                        {embed.description && (
                            <Text variant="text-sm/normal" className="messagelogger-embed-description">
                                {embed.description}
                            </Text>
                        )}
                        {embed.image && (
                            <img 
                                src={embed.image.proxy_url || embed.image.url}
                                alt="Embed image"
                                className="messagelogger-embed-image"
                            />
                        )}
                        {embed.thumbnail && (
                            <img 
                                src={embed.thumbnail.proxy_url || embed.thumbnail.url}
                                alt="Embed thumbnail"
                                className="messagelogger-embed-thumbnail"
                            />
                        )}
                    </div>
                ))}
            </div>
        );
    };

    return (
        <div className={`messagelogger-message ${message.deleted ? 'messagelogger-message-deleted' : ''}`}>
            <div className="messagelogger-message-header">
                <img 
                    src={getAvatarUrl(message.author.avatar)}
                    alt={message.author.username}
                    className="messagelogger-avatar"
                />
                <div className="messagelogger-message-content">
                    <div className="messagelogger-author-info">
                        <Text variant="text-md/semibold" className="messagelogger-author-name">
                            {message.author.globalName || message.author.username}
                        </Text>
                        <Text variant="text-xs/normal" className="messagelogger-timestamp">
                            {formatTimestamp(message.timestamp)}
                        </Text>
                        {status && (
                            <Text variant="text-xs/normal" className={`messagelogger-status ${status.className}`}>
                                [{status.label}]
                                {status.timestamp && status.timestamp !== message.timestamp && (
                                    <span className="messagelogger-status-time">
                                        {formatTimestamp(status.timestamp)}
                                    </span>
                                )}
                            </Text>
                        )}
                    </div>
                    
                    {message.content && (
                        <Text variant="text-sm/normal" className="messagelogger-text">
                            {message.content}
                        </Text>
                    )}
                    
                    {renderAttachments()}
                    {renderStickers()}
                    {renderEmbeds()}
                </div>
            </div>
            
            <div className="messagelogger-message-id">
                ID: {message.id}
            </div>
        </div>
    );
}