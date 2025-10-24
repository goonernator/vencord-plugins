/*
 * Vencord, a modification for Discord's desktop app
 * Copyright (c) 2024 Vendicated and contributors
 *
 * This program is free software: you can redistribute it and/or modify
 * it under the terms of the GNU General Public License as published by
 * the Free Software Foundation, either version 3 of the License, or
 * (at your option) any later version.
 *
 * This program is distributed in the hope that it will be useful,
 * but WITHOUT ANY WARRANTY; without even the implied warranty of
 * MERCHANTABILITY or FITNESS FOR A PARTICULAR PURPOSE.  See the
 * GNU General Public License for more details.
 *
 * You should have received a copy of the GNU General Public License
 * along with this program.  If not, see <https://www.gnu.org/licenses/>.
*/

import { definePluginSettings } from "@api/Settings";
import { Devs } from "@utils/constants";
import definePlugin, { OptionType } from "@utils/types";
import { showToast, Toasts } from "@webpack/common";

import { extractElementCSS, formatExtractedCSS, getThemingCSS } from "./utils";
import { openCSSModal } from "./CSSModal";

const settings = definePluginSettings({
    includeInherited: {
        type: OptionType.BOOLEAN,
        description: "Include inherited CSS properties",
        default: false
    },
    includeDefaults: {
        type: OptionType.BOOLEAN,
        description: "Include default browser styles",
        default: false
    },
    includeChildren: {
        type: OptionType.BOOLEAN,
        description: "Include child elements in extraction",
        default: false
    },
    maxDepth: {
        type: OptionType.NUMBER,
        description: "Maximum depth for child extraction",
        default: 2,
        markers: [1, 2, 3, 4, 5]
    },
    formatOutput: {
        type: OptionType.SELECT,
        description: "CSS output format",
        options: [
            { label: "Formatted", value: "formatted", default: true },
            { label: "Minified", value: "minified" }
        ]
    },
    extractionMode: {
        type: OptionType.SELECT,
        description: "CSS extraction mode",
        options: [
            { label: "All Properties", value: "all", default: true },
            { label: "Theming Only", value: "theming" }
        ]
    }
});

// Handle right-click context menu
function handleContextMenu(event: MouseEvent) {
    // Only show context menu on Ctrl+Right-click to avoid interfering with Discord's menus
    if (!event.ctrlKey) return;
    
    event.preventDefault();
    event.stopPropagation();
    
    const element = event.target as HTMLElement;
    if (!element) return;
    
    // Create a simple context menu
    const contextMenu = document.createElement('div');
    contextMenu.style.cssText = `
        position: fixed;
        top: ${event.clientY}px;
        left: ${event.clientX}px;
        background: var(--background-floating);
        border: 1px solid var(--background-modifier-accent);
        border-radius: 4px;
        padding: 8px 0;
        z-index: 10000;
        box-shadow: var(--elevation-high);
        min-width: 120px;
    `;
    
    const menuItem = document.createElement('div');
    menuItem.textContent = 'Extract CSS';
    menuItem.style.cssText = `
        padding: 8px 12px;
        cursor: pointer;
        color: var(--text-normal);
        font-size: 14px;
        font-family: var(--font-primary);
    `;
    
    menuItem.addEventListener('mouseenter', () => {
        menuItem.style.backgroundColor = 'var(--background-modifier-hover)';
    });
    
    menuItem.addEventListener('mouseleave', () => {
        menuItem.style.backgroundColor = 'transparent';
    });
    
    menuItem.addEventListener('click', () => {
        try {
            const extractedCSS = extractElementCSS(element, {
                includeInherited: settings.store.extractionMode === 'inherited',
                includeChildren: settings.store.includeChildren,
                maxDepth: settings.store.maxDepth,
                includeDefaults: settings.store.includeDefaults,
                formatOutput: settings.store.formatOutput
            });
            
            const formattedCSS = formatExtractedCSS(extractedCSS, {
                includeInherited: settings.store.extractionMode === 'inherited',
                includeChildren: settings.store.includeChildren,
                maxDepth: settings.store.maxDepth,
                includeDefaults: settings.store.includeDefaults,
                formatOutput: settings.store.formatOutput
            });
            
            if (!formattedCSS) {
                showToast("No CSS found for this element", Toasts.Type.MESSAGE);
                return;
            }
            
            openCSSModal(formattedCSS, element);
            
        } catch (error) {
            console.error("CSS Extraction Error:", error);
            showToast("Failed to extract CSS", Toasts.Type.FAILURE);
        }
        
        document.body.removeChild(contextMenu);
    });
    
    contextMenu.appendChild(menuItem);
    document.body.appendChild(contextMenu);
    
    // Remove context menu when clicking elsewhere
    const removeMenu = (e: MouseEvent) => {
        if (!contextMenu.contains(e.target as Node)) {
            document.body.removeChild(contextMenu);
            document.removeEventListener('click', removeMenu);
        }
    };
    
    setTimeout(() => {
        document.addEventListener('click', removeMenu);
    }, 0);
}



export default definePlugin({
    name: "CSSExtractor",
    description: "Extract CSS from any DOM element via Ctrl+Right-click",
    authors: [Devs.Ven],
    settings,
    
    start() {
        document.addEventListener("contextmenu", handleContextMenu, true);
    },
    
    stop() {
        document.removeEventListener("contextmenu", handleContextMenu, true);
    }
});