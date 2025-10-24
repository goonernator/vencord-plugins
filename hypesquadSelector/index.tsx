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

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import { findByPropsLazy } from "@webpack";
import { ModalCloseButton, ModalContent, ModalFooter, ModalHeader, ModalProps, ModalRoot, openModal } from "@utils/modal";
import { Button, Forms, RestAPI, showToast, Text, Toasts, UserStore } from "@webpack/common";

const HypeSquadHouses = {
    BRAVERY: 1,
    BRILLIANCE: 2,
    BALANCE: 3
} as const;

const HouseNames = {
    [HypeSquadHouses.BRAVERY]: "Bravery",
    [HypeSquadHouses.BRILLIANCE]: "Brilliance", 
    [HypeSquadHouses.BALANCE]: "Balance"
} as const;

const HouseDescriptions = {
    [HypeSquadHouses.BRAVERY]: "HypeSquad Bravery - For the bold and adventurous",
    [HypeSquadHouses.BRILLIANCE]: "HypeSquad Brilliance - For the creative and innovative",
    [HypeSquadHouses.BALANCE]: "HypeSquad Balance - For the balanced and strategic"
} as const;

const HouseColors = {
    [HypeSquadHouses.BRAVERY]: "#9C84EF",
    [HypeSquadHouses.BRILLIANCE]: "#F47B67", 
    [HypeSquadHouses.BALANCE]: "#45DDC0"
} as const;

async function changeHypeSquadHouse(house: number) {
    try {
        const response = await RestAPI.post({
            url: "/hypesquad/online",
            body: {
                house_id: house
            }
        });

        if (response.ok) {
            showToast(`Successfully joined HypeSquad ${HouseNames[house]}!`, Toasts.Type.SUCCESS);
        } else {
            throw new Error(`HTTP ${response.status}`);
        }
    } catch (error) {
        console.error("Failed to change HypeSquad house:", error);
        showToast("Failed to change HypeSquad house. Please try again.", Toasts.Type.FAILURE);
    }
}

function HypeSquadSelectorModal({ onClose, ...props }: ModalProps) {
    const currentUser = UserStore.getCurrentUser();
    
    return (
        <ModalRoot {...props}>
            <ModalHeader>
                <Text variant="heading-lg/semibold" style={{ flexGrow: 1 }}>
                    Select HypeSquad House
                </Text>
                <ModalCloseButton onClick={onClose} />
            </ModalHeader>
            <ModalContent>
                <Forms.FormSection>
                    <Text variant="text-md/normal" style={{ marginBottom: "16px" }}>
                        Choose which HypeSquad house you'd like to join. You can change this at any time.
                    </Text>
                    
                    <div style={{ display: "flex", flexDirection: "column", gap: "12px" }}>
                        {Object.entries(HouseNames).map(([houseId, houseName]) => {
                            const id = parseInt(houseId);
                            return (
                                <Button
                                    key={id}
                                    onClick={() => {
                                        changeHypeSquadHouse(id);
                                        onClose();
                                    }}
                                    style={{
                                        backgroundColor: HouseColors[id],
                                        borderColor: HouseColors[id],
                                        color: "black",
                                        padding: "12px 16px",
                                        borderRadius: "4px",
                                        border: "1px solid",
                                        cursor: "pointer",
                                        transition: "all 0.2s ease"
                                    }}
                                    onMouseEnter={(e) => {
                                        e.currentTarget.style.opacity = "0.8";
                                    }}
                                    onMouseLeave={(e) => {
                                        e.currentTarget.style.opacity = "1";
                                    }}
                                >
                                    <div style={{ textAlign: "left" }}>
                                        <Text variant="text-md/semibold" style={{ color: "white", display: "block" }}>
                                            {houseName}
                                        </Text>
                                        <Text variant="text-sm/normal" style={{ color: "rgba(255, 255, 255, 0.8)", display: "block" }}>
                                            {HouseDescriptions[id]}
                                        </Text>
                                    </div>
                                </Button>
                            );
                        })}
                    </div>
                </Forms.FormSection>
            </ModalContent>
            <ModalFooter>
                <Button onClick={onClose} look={Button.Looks.LINK} color={Button.Colors.PRIMARY}>
                    Cancel
                </Button>
            </ModalFooter>
        </ModalRoot>
    );
}

function openHypeSquadSelector() {
    openModal(props => <HypeSquadSelectorModal {...props} />);
}

export default definePlugin({
    name: "HypeSquadSelector",
    description: "Allows you to quickly change your HypeSquad house via the Vencord toolbox",
    authors: [1274663184912875626], // Replace with your dev info if you have one
    
    toolboxActions: {
        "Select HypeSquad": openHypeSquadSelector
    }
});