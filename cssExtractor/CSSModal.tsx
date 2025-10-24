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

import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, ModalSize } from "@utils/modal";
import { Button, Forms, TextArea, Toasts, useState } from "@webpack/common";
import { copyToClipboard } from "@utils/clipboard";

interface CSSModalProps extends ModalProps {
    css: string;
    elementInfo: {
        tagName: string;
        className?: string;
        id?: string;
    };
}

export function CSSModal({ css, elementInfo, ...props }: CSSModalProps) {
    const [cssContent, setCssContent] = useState(css);
    const [copied, setCopied] = useState(false);

    const handleCopy = () => {
        copyToClipboard(cssContent);
        setCopied(true);
        Toasts.show({
            message: "CSS copied to clipboard!",
            type: Toasts.Type.SUCCESS,
            id: "css-extractor-copy"
        });
        
        setTimeout(() => setCopied(false), 2000);
    };

    const handleSave = () => {
        // Create a downloadable file
        const blob = new Blob([cssContent], { type: 'text/css' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = `extracted-styles-${elementInfo.tagName.toLowerCase()}${elementInfo.id ? `-${elementInfo.id}` : ''}.css`;
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
        
        Toasts.show({
            message: "CSS file saved!",
            type: Toasts.Type.SUCCESS,
            id: "css-extractor-save"
        });
    };

    const getElementDescription = () => {
        let desc = elementInfo.tagName.toLowerCase();
        if (elementInfo.id) desc += `#${elementInfo.id}`;
        if (elementInfo.className) {
            const classes = elementInfo.className.split(' ').filter(c => c.length > 0).slice(0, 3);
            if (classes.length > 0) desc += `.${classes.join('.')}`;
        }
        return desc;
    };

    return (
        <ModalRoot {...props} size={ModalSize.LARGE}>
            <ModalHeader>
                <Forms.FormTitle tag="h2">Extracted CSS</Forms.FormTitle>
                <Forms.FormText type={Forms.FormText.Types.DESCRIPTION}>
                    CSS extracted from: <code>{getElementDescription()}</code>
                </Forms.FormText>
                <ModalCloseButton onClick={props.onClose} />
            </ModalHeader>
            
            <ModalContent>
                <Forms.FormSection>
                    <Forms.FormTitle tag="h3">CSS Code</Forms.FormTitle>
                    <Forms.FormText type={Forms.FormText.Types.DESCRIPTION}>
                        You can edit the CSS below before copying or saving it.
                    </Forms.FormText>
                    
                    <TextArea
                        value={cssContent}
                        onChange={setCssContent}
                        rows={15}
                        style={{
                            fontFamily: 'var(--font-code)',
                            fontSize: '14px',
                            lineHeight: '1.4',
                            marginTop: '8px',
                            resize: 'vertical'
                        }}
                        placeholder="No CSS extracted..."
                    />
                </Forms.FormSection>
                
                <Forms.FormSection style={{ marginTop: '16px' }}>
                    <Forms.FormTitle tag="h3">Usage Tips</Forms.FormTitle>
                    <Forms.FormText type={Forms.FormText.Types.DESCRIPTION}>
                        • Use this CSS in your theme files or QuickCSS<br/>
                        • Modify selectors to target broader elements<br/>
                        • Remove or adjust properties as needed for your theme<br/>
                        • Test changes in DevTools before applying permanently
                    </Forms.FormText>
                </Forms.FormSection>
            </ModalContent>
            
            <ModalFooter>
                <Button
                    color={Button.Colors.BRAND}
                    onClick={handleCopy}
                    disabled={!cssContent.trim()}
                >
                    {copied ? "Copied!" : "Copy to Clipboard"}
                </Button>
                
                <Button
                    color={Button.Colors.PRIMARY}
                    onClick={handleSave}
                    disabled={!cssContent.trim()}
                    style={{ marginLeft: '8px' }}
                >
                    Save as File
                </Button>
                
                <Button
                    color={Button.Colors.TRANSPARENT}
                    look={Button.Looks.LINK}
                    onClick={props.onClose}
                    style={{ marginLeft: '8px' }}
                >
                    Close
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

export function openCSSModal(css: string, element: HTMLElement) {
    const { openModal } = require("@utils/modal");
    
    const elementInfo = {
        tagName: element.tagName,
        className: element.className,
        id: element.id
    };
    
    openModal(props => (
        <CSSModal
            {...props}
            css={css}
            elementInfo={elementInfo}
        />
    ));
}