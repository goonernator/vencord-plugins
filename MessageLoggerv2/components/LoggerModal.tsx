/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { ModalCloseButton, ModalContent, ModalHeader, ModalProps, ModalRoot, ModalSize } from "@utils/modal";
import { User } from "@vencord/discord-types";
import { Button, React, Text, TextInput, UserStore } from "@webpack/common";
import Plugins from "~plugins";

import { LoggedMessage, MessageStorage } from "../storage";
import { MessageList } from "./MessageList";

interface LoggerModalProps extends ModalProps {
    user: User;
    messageStorage: MessageStorage;
}

export function LoggerModal({ user, messageStorage, ...props }: LoggerModalProps) {
    const [messages, setMessages] = React.useState<LoggedMessage[]>([]);
    const [searchQuery, setSearchQuery] = React.useState("");
    const [isLoading, setIsLoading] = React.useState(true);

    React.useEffect(() => {
        const loadMessages = () => {
            setIsLoading(true);
            const userMessages = searchQuery 
                ? messageStorage.searchMessages(user.id, searchQuery)
                : messageStorage.getMessages(user.id);
            setMessages(userMessages);
            setIsLoading(false);
        };

        loadMessages();
    }, [user.id, searchQuery, messageStorage]);

    const handleClearMessages = () => {
        if (confirm(`Are you sure you want to clear all logged messages for ${user.username}?`)) {
            messageStorage.clearMessages(user.id);
            setMessages([]);
        }
    };

    const handleCleanDM = async () => {
        const currentUserId = UserStore.getCurrentUser()?.id;
        if (!currentUserId) return;
        
        if (confirm(`Are you sure you want to delete all DM messages you sent to ${user.username}? This will permanently remove all your messages from this conversation, including those sent before the logger was active.`)) {
            // Import the plugin's cleanDMMessages function
            const plugin = Plugins.MessageLoggerv2;
             if (plugin && plugin.cleanDMMessages) {
                 const success = await plugin.cleanDMMessages(user.id);
                if (success) {
                    // Reload messages to reflect changes
                    const userMessages = searchQuery 
                        ? messageStorage.searchMessages(user.id, searchQuery)
                        : messageStorage.getMessages(user.id);
                    setMessages(userMessages);
                } else {
                    alert("Failed to clean DM messages. Please try again.");
                }
            }
        }
    };

    const handleExportMessages = () => {
        const userMessages = messageStorage.getMessages(user.id);
        const exportData = {
            user: {
                id: user.id,
                username: user.username,
                globalName: user.globalName
            },
            messages: userMessages,
            exportedAt: new Date().toISOString()
        };

        const blob = new Blob([JSON.stringify(exportData, null, 2)], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `${user.username}-messages-${new Date().toISOString().split('T')[0]}.json`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    };

    const messageCount = messageStorage.getMessageCount(user.id);

    return (
        <ModalRoot {...props} size={ModalSize.LARGE}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>
                    Message Logger - {user.globalName || user.username}
                </Text>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>
            <ModalContent className="messagelogger-modal" style={{ padding: "16px", maxHeight: "70vh", display: "flex", flexDirection: "column" }}>
                <div className="messagelogger-search-container">
                    <TextInput
                        placeholder="Search messages..."
                        value={searchQuery}
                        onChange={setSearchQuery}
                        className="messagelogger-search-input"
                    />
                    <Text variant="text-sm/normal" className="messagelogger-stats">
                        {messageCount} messages logged
                    </Text>
                </div>
                
                <div className="messagelogger-actions">
                    <Button
                        size={Button.Sizes.SMALL}
                        color={Button.Colors.PRIMARY}
                        onClick={handleExportMessages}
                        disabled={messageCount === 0}
                    >
                        Export Messages
                    </Button>
                    <Button
                        size={Button.Sizes.SMALL}
                        color={Button.Colors.BRAND}
                        onClick={handleCleanDM}
                        disabled={false}
                    >
                        Clean DM
                    </Button>
                    <Button
                        size={Button.Sizes.SMALL}
                        color={Button.Colors.RED}
                        onClick={handleClearMessages}
                        disabled={messageCount === 0}
                    >
                        Clear All
                    </Button>
                </div>

                <div className="messagelogger-content">
                    {isLoading ? (
                        <div style={{ padding: "20px", textAlign: "center" }}>
                            <Text variant="text-md/normal">Loading messages...</Text>
                        </div>
                    ) : messages.length === 0 ? (
                        <div style={{ padding: "20px", textAlign: "center" }}>
                            <Text variant="text-md/normal" style={{ color: "var(--text-muted)" }}>
                                {searchQuery ? "No messages found matching your search." : "No messages logged for this user yet."}
                            </Text>
                        </div>
                    ) : (
                        <MessageList messages={messages} />
                    )}
                </div>
            </ModalContent>
        </ModalRoot>
    );
}