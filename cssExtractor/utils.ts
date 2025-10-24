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

export interface CSSExtractionOptions {
    includeInherited: boolean;
    includeDefaults: boolean;
    formatOutput: 'minified' | 'formatted';
    includeChildren: boolean;
    maxDepth: number;
}

export interface ExtractedCSS {
    selector: string;
    properties: Record<string, string>;
    children?: ExtractedCSS[];
}

// Enhanced CSS property categories for better filtering
const CSS_CATEGORIES = {
    layout: [
        'display', 'position', 'top', 'right', 'bottom', 'left', 'z-index',
        'width', 'height', 'min-width', 'min-height', 'max-width', 'max-height',
        'margin', 'margin-top', 'margin-right', 'margin-bottom', 'margin-left',
        'padding', 'padding-top', 'padding-right', 'padding-bottom', 'padding-left',
        'box-sizing', 'overflow', 'overflow-x', 'overflow-y', 'visibility'
    ],
    flexbox: [
        'flex', 'flex-direction', 'flex-wrap', 'flex-flow', 'justify-content',
        'align-items', 'align-content', 'align-self', 'flex-grow', 'flex-shrink',
        'flex-basis', 'gap', 'row-gap', 'column-gap'
    ],
    grid: [
        'grid', 'grid-template', 'grid-template-columns', 'grid-template-rows',
        'grid-template-areas', 'grid-column', 'grid-row', 'grid-area',
        'grid-gap', 'grid-column-gap', 'grid-row-gap'
    ],
    typography: [
        'font', 'font-family', 'font-size', 'font-weight', 'font-style',
        'font-variant', 'line-height', 'letter-spacing', 'word-spacing',
        'text-align', 'text-decoration', 'text-transform', 'text-indent',
        'text-shadow', 'white-space', 'word-wrap', 'word-break'
    ],
    colors: [
        'color', 'background', 'background-color', 'background-image',
        'background-position', 'background-size', 'background-repeat',
        'background-attachment', 'background-clip', 'background-origin'
    ],
    borders: [
        'border', 'border-width', 'border-style', 'border-color',
        'border-top', 'border-right', 'border-bottom', 'border-left',
        'border-radius', 'border-top-left-radius', 'border-top-right-radius',
        'border-bottom-left-radius', 'border-bottom-right-radius',
        'outline', 'outline-width', 'outline-style', 'outline-color', 'outline-offset'
    ],
    effects: [
        'opacity', 'transform', 'transform-origin', 'transition', 'transition-property',
        'transition-duration', 'transition-timing-function', 'transition-delay',
        'animation', 'animation-name', 'animation-duration', 'animation-timing-function',
        'animation-delay', 'animation-iteration-count', 'animation-direction',
        'animation-fill-mode', 'animation-play-state', 'box-shadow', 'filter',
        'backdrop-filter', 'clip-path', 'mask'
    ]
};

// Default values that are commonly not needed in themes
const DEFAULT_VALUES = {
    'color': ['rgb(0, 0, 0)', 'rgba(0, 0, 0, 1)', 'black', '#000000', '#000'],
    'background-color': ['rgba(0, 0, 0, 0)', 'transparent', 'initial'],
    'background-image': ['none'],
    'border-style': ['none'],
    'border-width': ['0px', '0'],
    'border-color': ['currentcolor'],
    'margin': ['0px', '0'],
    'padding': ['0px', '0'],
    'transform': ['none'],
    'transition': ['none'],
    'animation': ['none'],
    'box-shadow': ['none'],
    'filter': ['none'],
    'opacity': ['1'],
    'z-index': ['auto'],
    'position': ['static'],
    'display': ['inline'],
    'overflow': ['visible'],
    'text-decoration': ['none'],
    'text-transform': ['none'],
    'font-weight': ['400', 'normal'],
    'font-style': ['normal'],
    'line-height': ['normal']
};

/**
 * Generate a more specific and useful CSS selector for an element
 */
export function generateAdvancedSelector(element: HTMLElement, options: { useDataAttributes?: boolean, useAriaLabels?: boolean } = {}): string {
    const selectors: string[] = [];
    
    // Try ID first (most specific)
    if (element.id && !element.id.match(/^[\d-]/)) {
        return `#${CSS.escape(element.id)}`;
    }
    
    // Try data attributes for Discord-specific elements
    if (options.useDataAttributes) {
        const dataAttrs = Array.from(element.attributes)
            .filter(attr => attr.name.startsWith('data-') && attr.value)
            .slice(0, 2); // Limit to avoid overly complex selectors
        
        if (dataAttrs.length > 0) {
            const dataSelector = dataAttrs
                .map(attr => `[${attr.name}="${CSS.escape(attr.value)}"]`)
                .join('');
            selectors.push(`${element.tagName.toLowerCase()}${dataSelector}`);
        }
    }
    
    // Try aria-label for accessibility-based selection
    if (options.useAriaLabels && element.getAttribute('aria-label')) {
        const ariaLabel = element.getAttribute('aria-label')!;
        selectors.push(`${element.tagName.toLowerCase()}[aria-label="${CSS.escape(ariaLabel)}"]`);
    }
    
    // Use class names (filter out generated/hash classes)
    if (element.className && typeof element.className === 'string') {
        const classes = element.className.trim().split(/\s+/)
            .filter(cls => {
                // Filter out likely generated classes (long hashes, etc.)
                return cls.length > 0 && 
                       cls.length < 30 && 
                       !cls.match(/^[a-f0-9]{8,}$/i) && // hex hashes
                       !cls.match(/^_[a-zA-Z0-9]{6,}$/); // underscore prefixed hashes
            })
            .slice(0, 3); // Limit classes to avoid overly specific selectors
        
        if (classes.length > 0) {
            const classSelector = `.${classes.map(cls => CSS.escape(cls)).join('.')}`;
            selectors.push(classSelector);
        }
    }
    
    // Fallback to structural selector
    const tagName = element.tagName.toLowerCase();
    const parent = element.parentElement;
    
    if (parent && selectors.length === 0) {
        const siblings = Array.from(parent.children)
            .filter(child => child.tagName === element.tagName);
        
        if (siblings.length > 1) {
            const index = siblings.indexOf(element) + 1;
            selectors.push(`${tagName}:nth-child(${index})`);
        } else {
            selectors.push(tagName);
        }
    }
    
    return selectors[0] || tagName;
}

/**
 * Extract CSS properties from an element with advanced filtering
 */
export function extractElementProperties(element: HTMLElement, options: CSSExtractionOptions): Record<string, string> {
    const computedStyles = window.getComputedStyle(element);
    const properties: Record<string, string> = {};
    
    let propertiesToCheck: string[];
    
    if (options.includeInherited) {
        propertiesToCheck = Array.from(computedStyles);
    } else {
        // Get relevant properties based on categories
        propertiesToCheck = Object.values(CSS_CATEGORIES).flat();
    }
    
    for (const property of propertiesToCheck) {
        const value = computedStyles.getPropertyValue(property);
        
        if (shouldIncludeProperty(property, value, options)) {
            properties[property] = value;
        }
    }
    
    return properties;
}

/**
 * Check if a CSS property should be included based on various criteria
 */
export function shouldIncludeProperty(property: string, value: string, options: CSSExtractionOptions): boolean {
    // Skip empty values
    if (!value || value === '' || value === 'none' || value === 'auto') {
        return false;
    }
    
    // Skip default values if option is disabled
    if (!options.includeDefaults) {
        const defaults = DEFAULT_VALUES[property];
        if (defaults && defaults.includes(value)) {
            return false;
        }
        
        // Skip initial/inherit/unset values
        if (['initial', 'inherit', 'unset', 'revert'].includes(value)) {
            return false;
        }
    }
    
    // Skip vendor prefixes for cleaner output
    if (property.startsWith('-webkit-') || property.startsWith('-moz-') || 
        property.startsWith('-ms-') || property.startsWith('-o-')) {
        return false;
    }
    
    return true;
}

/**
 * Extract CSS from element and optionally its children
 */
export function extractElementCSS(element: HTMLElement, options: CSSExtractionOptions, depth = 0): ExtractedCSS {
    const selector = generateAdvancedSelector(element, {
        useDataAttributes: true,
        useAriaLabels: true
    });
    
    const properties = extractElementProperties(element, options);
    
    const result: ExtractedCSS = {
        selector,
        properties
    };
    
    // Extract children if requested and within depth limit
    if (options.includeChildren && depth < options.maxDepth) {
        const children: ExtractedCSS[] = [];
        
        for (const child of Array.from(element.children)) {
            if (child instanceof HTMLElement) {
                const childCSS = extractElementCSS(child, options, depth + 1);
                if (Object.keys(childCSS.properties).length > 0) {
                    children.push(childCSS);
                }
            }
        }
        
        if (children.length > 0) {
            result.children = children;
        }
    }
    
    return result;
}

/**
 * Format extracted CSS into a string
 */
export function formatExtractedCSS(extracted: ExtractedCSS | ExtractedCSS[], options: CSSExtractionOptions): string {
    const cssBlocks: string[] = [];
    const extractedArray = Array.isArray(extracted) ? extracted : [extracted];
    
    function formatBlock(item: ExtractedCSS, indent = 0): void {
        const properties = Object.entries(item.properties);
        if (properties.length === 0) return;
        
        const indentStr = options.formatOutput === 'formatted' ? '  '.repeat(indent) : '';
        const newline = options.formatOutput === 'formatted' ? '\n' : '';
        const space = options.formatOutput === 'formatted' ? ' ' : '';
        
        if (options.formatOutput === 'minified') {
            const propStr = properties.map(([prop, val]) => `${prop}:${val}`).join(';');
            cssBlocks.push(`${item.selector}{${propStr}}`);
        } else {
            cssBlocks.push(`${indentStr}${item.selector}${space}{`);
            for (const [prop, val] of properties) {
                cssBlocks.push(`${indentStr}  ${prop}:${space}${val};`);
            }
            cssBlocks.push(`${indentStr}}`);
        }
        
        // Format children
        if (item.children) {
            for (const child of item.children) {
                formatBlock(child, indent);
            }
        }
    }
    
    for (const item of extractedArray) {
        formatBlock(item);
    }
    
    return cssBlocks.join(options.formatOutput === 'formatted' ? '\n\n' : '');
}

/**
 * Get CSS for theming purposes - focuses on colors, backgrounds, and visual properties
 */
export function getThemingCSS(element: HTMLElement, options: Partial<CSSExtractionOptions> = {}): string {
    const fullOptions: CSSExtractionOptions = {
        includeInherited: false,
        includeDefaults: false,
        formatOutput: 'formatted',
        includeChildren: false,
        maxDepth: 0,
        ...options
    };
    
    const extracted = extractElementCSS(element, fullOptions);
    
    // Filter to theming-relevant properties
    const themingProps = [...CSS_CATEGORIES.colors, ...CSS_CATEGORIES.borders, ...CSS_CATEGORIES.effects];
    const filteredProperties: Record<string, string> = {};
    
    for (const [prop, value] of Object.entries(extracted.properties)) {
        if (themingProps.includes(prop)) {
            filteredProperties[prop] = value;
        }
    }
    
    return formatExtractedCSS({ ...extracted, properties: filteredProperties }, fullOptions);
}