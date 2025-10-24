/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { React, Text } from "@webpack/common";

import { LoggedMessage } from "../storage";
import { MessageItem } from "./MessageItem";

interface MessageListProps {
    messages: LoggedMessage[];
}

export function MessageList({ messages }: MessageListProps) {
    const containerRef = React.useRef<HTMLDivElement>(null);

    return (
        <div 
            ref={containerRef}
            className="messagelogger-list"
        >
            {messages.map((message, index) => (
                <MessageItem 
                    key={`${message.id}-${index}`} 
                    message={message} 
                />
            ))}
        </div>
    );
}