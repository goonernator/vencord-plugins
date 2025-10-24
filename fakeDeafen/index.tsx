/*
 * Vencord, a Discord client mod
 * Copyright (c) 2024 Vendicated and contributors
 * SPDX-License-Identifier: GPL-3.0-or-later
 */

import { disableStyle, enableStyle } from "@api/Styles";
import ErrorBoundary from "@components/ErrorBoundary";
import definePlugin from "@utils/types";
import { findByCodeLazy } from "@webpack";

import { settings } from "./settings";
import style from "./style.css?managed";

export let faked = true;

function mute() {
    const muteBtn = (document.querySelector('[aria-label="Mute"]') as HTMLElement);
    if (muteBtn) muteBtn.click();
}

function deafen() {
    const deafenBtn = (document.querySelector('[aria-label="Deafen"]') as HTMLElement);
    if (deafenBtn) deafenBtn.click();
}

const Button = findByCodeLazy("Button.Sizes.NONE,disabled:");

function makeIcon(enabled?: boolean) {
    return function () {
        return (
            <svg
                xmlns="http://www.w3.org/2000/svg"
                width="19"
                height="19"
                viewBox="0 0 512 512"
            >
                <path fill="currentColor" d="M512,223.537c0-61.46-49.773-111.264-111.264-111.264c-11.768,0-22.922,2.31-33.496,5.644C366.948,56.657,317.346,7.084,255.985,7.084c-61.32,0-110.993,49.573-111.224,110.833c-10.573-3.334-21.728-5.644-33.496-5.644C49.774,112.273,0,162.077,0,223.537c0,49.241,32.171,90.479,76.533,105.12c-13.294,18.354-21.276,40.656-21.276,64.985c0,61.46,49.773,111.274,111.254,111.274c36.86,0,69.222-18.043,89.475-45.646c20.283,27.603,52.645,45.646,89.465,45.646c61.521,0,111.264-49.813,111.264-111.274c0-24.329-7.993-46.631-21.246-64.985C479.829,314.017,512,272.779,512,223.537zM255.985,337.433c-31.971,0-57.927-25.916-57.927-57.887c0-31.981,25.956-57.897,57.927-57.897c32,0,57.926,25.916,57.926,57.897C313.912,311.517,287.986,337.433,255.985,337.433z" />
                {!enabled &&
                    <line
                        x1="495"
                        y1="10"
                        x2="10"
                        y2="464"
                        stroke="var(--status-danger)"
                        strokeWidth="40"
                    />
                }
            </svg>
        );
    };
}

const defaultLocationSelector = '[aria-label*="User area"]>*>[class*="flex_"][class*="horizontal__"][class*="justifyStart__"][class*="alignStretch_"][class*="noWrap__"]';
const secondaryLocationSelector = '[aria-label*="User area"]>[class*="flex_"][class*="horizontal__"][class*="justifyStart__"][class*="alignStretch_"][class*="noWrap__"]';
const fixButtons = () => {
    let btns;

    btns = document.querySelector(defaultLocationSelector); // In User area
    if (btns && btns.children.length > 4) {
        if (typeof btns?.parentElement?.parentElement?.appendChild === "function") btns.parentElement.parentElement.appendChild(btns);
        return;
    }

    btns = document.querySelector(secondaryLocationSelector); // Already moved
    if (btns && btns.children.length < 5) {
        const avatarWrapper = document.querySelector('div[class*="avatarWrapper_"][class*="withTagAsButton_"]:only-child');
        if (avatarWrapper && ![...avatarWrapper.childNodes].includes(btns)) avatarWrapper.appendChild(btns);
        return;
    }
};
const buttonsObserver = new MutationObserver(fixButtons);

function watchButtons() {
    const btns = document.querySelector(defaultLocationSelector) || document.querySelector(secondaryLocationSelector);
    if (!btns) return;
    buttonsObserver.disconnect();
    buttonsObserver.observe(btns, { subtree: true, childList: true, attributes: false });
}

function FakeVoiceOptionToggleButton() {
    watchButtons();
    return (
        <Button
            tooltipText={faked ? ":3" : ":3"}
            icon={makeIcon(!faked)}
            role="switch"
            aria-checked={!faked}
            aria-label="Fake voice options button"
            onClick={() => {
                faked = !faked;

                deafen();
                setTimeout(deafen, 200);

                if (settings.store.muteOnFakeDeafen && faked) setTimeout(mute, 350);
            }}
        />
    );
}

export default definePlugin({
    name: "FakeVoiceOptions",
    description: "Fake mute, deafen, and camera for VCs",
    authors: [{ name: "kam", id: 968658669145317456n }],
    patches: [
        {
            find: ".Messages.ACCOUNT_SPEAKING_WHILE_MUTED",
            replacement: {
                match: /this\.renderNameZone\(\).+?children:\[/,
                replace: "$&$self.FakeVoiceOptionToggleButton(),"
            }
        },
        {
            find: "}voiceStateUpdate(",
            replacement: {
                match: /self_mute:([^,]+),self_deaf:([^,]+),self_video:([^,]+)/,
                replace: "self_mute:$self.toggle($1,'fakeMute'),self_deaf:$self.toggle($2,'fakeDeafen'),self_video:$self.toggle($3,'fakeCam')",
            }
        }
    ],
    FakeVoiceOptionToggleButton: ErrorBoundary.wrap(FakeVoiceOptionToggleButton, { noop: true }),
    settings,
    toggle: (_o: any, key: string) => {
        return (faked === false) ? _o : settings.store[key];
    },
    start() {
        watchButtons();
        enableStyle(style);
    },
    stop() {
        watchButtons();
        disableStyle(style);
    }
});
