/*
 * ProfileLookup plugin for Vencord
 * Looks up a user by Discord ID and shows basic account info.
 */

import { Devs } from "@utils/constants";
import definePlugin from "@utils/types";
import {
    openModal,
    ModalRoot,
    ModalHeader,
    ModalContent,
    ModalFooter,
    ModalCloseButton,
} from "@utils/modal";
import { classNameFactory } from "@api/Styles";
import {
    React,
    Button,
    Text,
    TextInput,
    RestAPI,
    Constants,
    showToast,
    Toasts,
    FluxDispatcher,
    Avatar,
    IconUtils,
    GuildStore,
    UserStore,
} from "@webpack/common";
import { fetchUserProfile } from "@utils/discord";

interface ProfileInfo {
    id: string;
    username: string;
    discriminator: string;
    global_name?: string;
    avatar: string | null;
    bot: boolean;
    flags: number;
    banner: string | null;
    accentColor: number | null;
    premium_type?: number;
}

interface MutualGuild {
    id: string;
    name: string;
    icon: string | null;
    nick?: string;
    member_count?: number;
    owner?: boolean;
    permissions?: string;
    features?: string[];
}

interface ProfileBadge {
    id: string;
    description: string;
    icon: string;
    link?: string;
}

interface RecentLookup {
    id: string;
    username: string;
    global_name?: string;
    timestamp: number;
}

interface ComparisonProfile {
    profile: ProfileInfo;
    mutualGuilds: MutualGuild[];
}

const cl = classNameFactory("vc-profile-lookup-");

// User flags mapping for badges
const UserFlags = {
    STAFF: 1 << 0,
    PARTNER: 1 << 1,
    HYPESQUAD: 1 << 2,
    BUG_HUNTER_LEVEL_1: 1 << 3,
    HYPESQUAD_ONLINE_HOUSE_1: 1 << 6,
    HYPESQUAD_ONLINE_HOUSE_2: 1 << 7,
    HYPESQUAD_ONLINE_HOUSE_3: 1 << 8,
    PREMIUM_EARLY_SUPPORTER: 1 << 9,
    BUG_HUNTER_LEVEL_2: 1 << 14,
    VERIFIED_DEVELOPER: 1 << 17,
    CERTIFIED_MODERATOR: 1 << 18,
    BOT_HTTP_INTERACTIONS: 1 << 19,
    ACTIVE_DEVELOPER: 1 << 22,
};

const BadgeInfo = {
    [UserFlags.STAFF]: { name: "Discord Staff", icon: "5e74e9b61934fc1f67c65515d1f7e60d" },
    [UserFlags.PARTNER]: { name: "Partnered Server Owner", icon: "3f9748e53446a137a052f3454e2de41e" },
    [UserFlags.HYPESQUAD]: { name: "HypeSquad Events", icon: "bf01d1073931f921909045f3a39fd264" },
    [UserFlags.BUG_HUNTER_LEVEL_1]: { name: "Bug Hunter", icon: "2717692c7dca7289b35297368a940dd0" },
    [UserFlags.HYPESQUAD_ONLINE_HOUSE_1]: { name: "HypeSquad Bravery", icon: "8a88d63823d8a71cd5e390baa45efa02" },
    [UserFlags.HYPESQUAD_ONLINE_HOUSE_2]: { name: "HypeSquad Brilliance", icon: "011940fd013da3f7fb926e4a1cd2e618" },
    [UserFlags.HYPESQUAD_ONLINE_HOUSE_3]: { name: "HypeSquad Balance", icon: "3aa41de486fa12454c3761e8e223442e" },
    [UserFlags.PREMIUM_EARLY_SUPPORTER]: { name: "Early Nitro Supporter", icon: "7060786766c9c840eb3019e725d2b358" },
    [UserFlags.BUG_HUNTER_LEVEL_2]: { name: "Bug Hunter Level 2", icon: "848f79194d4be5ff5f81505cbd0ce1e6" },
    [UserFlags.VERIFIED_DEVELOPER]: { name: "Early Verified Bot Developer", icon: "6bdc42827a38498929a4920da12695d9" },
    [UserFlags.CERTIFIED_MODERATOR]: { name: "Moderator Programs Alumni", icon: "fee1624003e2fee35cb398e125dc479b" },
    [UserFlags.ACTIVE_DEVELOPER]: { name: "Active Developer", icon: "6bdc42827a38498929a4920da12695d9" },
};

// Cache for profile data
const profileCache = new Map<string, { data: ProfileInfo; mutualGuilds: MutualGuild[]; timestamp: number }>();
const CACHE_DURATION = 5 * 60 * 1000; // 5 minutes

// Local storage keys
const RECENT_LOOKUPS_KEY = "vc-profile-lookup-recent";
const MAX_RECENT_LOOKUPS = 10;

// Utility functions
function getAccountCreationDate(userId: string): Date {
    const timestamp = (BigInt(userId) >> 22n) + 1420070400000n;
    return new Date(Number(timestamp));
}

function formatDate(date: Date): string {
    return date.toLocaleDateString("en-US", {
        year: "numeric",
        month: "long",
        day: "numeric",
        hour: "2-digit",
        minute: "2-digit"
    });
}

function getBannerUrl(userId: string, banner: string | null, size = 600): string | null {
    if (!banner) return null;
    const extension = banner.startsWith("a_") ? "gif" : "png";
    return `https://cdn.discordapp.com/banners/${userId}/${banner}.${extension}?size=${size}`;
}

function getUserBadges(profile: ProfileInfo): ProfileBadge[] {
    const badges: ProfileBadge[] = [];
    let hasNitro = false;

    // Check for Nitro based on premium_type
    if (profile.premium_type && profile.premium_type > 0) {
        badges.push({
            id: "nitro",
            description: profile.premium_type === 2 ? "Nitro" : "Nitro Classic",
            icon: "2ba85e8026a8614b640c2837bcdfe21b",
        });
        hasNitro = true;
    }

    // Check for animated avatar (indicates Nitro) only if not already added
    if (!hasNitro && profile.avatar && profile.avatar.startsWith("a_")) {
        badges.push({
            id: "nitro",
            description: "Nitro",
            icon: "2ba85e8026a8614b640c2837bcdfe21b",
        });
        hasNitro = true;
    }

    // Check for banner (indicates Nitro) only if not already added
    if (!hasNitro && profile.banner) {
        badges.push({
            id: "nitro",
            description: "Nitro",
            icon: "2ba85e8026a8614b640c2837bcdfe21b",
        });
        hasNitro = true;
    }

    // Add badges based on user flags
    Object.entries(BadgeInfo).forEach(([flag, info]) => {
        if (profile.flags & parseInt(flag)) {
            badges.push({
                id: flag,
                description: info.name,
                icon: info.icon,
            });
        }
    });

    return badges;
}

function saveRecentLookup(profile: ProfileInfo) {
    try {
        const recent = getRecentLookups();
        const newLookup: RecentLookup = {
            id: profile.id,
            username: profile.username,
            global_name: profile.global_name,
            timestamp: Date.now()
        };
        
        // Remove existing entry if present
        const filtered = recent.filter(r => r.id !== profile.id);
        
        // Add to beginning and limit to MAX_RECENT_LOOKUPS
        const updated = [newLookup, ...filtered].slice(0, MAX_RECENT_LOOKUPS);
        
        localStorage.setItem(RECENT_LOOKUPS_KEY, JSON.stringify(updated));
    } catch (error) {
        console.warn("Failed to save recent lookup:", error);
    }
}

function getRecentLookups(): RecentLookup[] {
    try {
        const stored = localStorage.getItem(RECENT_LOOKUPS_KEY);
        return stored ? JSON.parse(stored) : [];
    } catch (error) {
        console.warn("Failed to load recent lookups:", error);
        return [];
    }
}

function clearRecentLookups() {
    try {
        localStorage.removeItem(RECENT_LOOKUPS_KEY);
    } catch (error) {
        console.warn("Failed to clear recent lookups:", error);
    }
}

function exportProfileData(profile: ProfileInfo, mutualGuilds: MutualGuild[], format: "json" | "text" = "json") {
    const data = {
        profile,
        mutualGuilds,
        accountCreated: formatDate(getAccountCreationDate(profile.id)),
        badges: getUserBadges(profile),
        exportedAt: new Date().toISOString()
    };

    let content: string;
    let filename: string;
    let mimeType: string;

    if (format === "json") {
        content = JSON.stringify(data, null, 2);
        filename = `discord-profile-${profile.username}-${profile.id}.json`;
        mimeType = "application/json";
    } else {
        content = `Discord Profile Export
========================
Username: ${profile.username}
Display Name: ${profile.global_name || "None"}
User ID: ${profile.id}
Account Created: ${formatDate(getAccountCreationDate(profile.id))}
Bot Account: ${profile.bot ? "Yes" : "No"}
Banner: ${profile.banner ? "Yes" : "No"}
Accent Color: ${profile.accentColor ? `#${profile.accentColor.toString(16).padStart(6, '0')}` : "None"}

Badges:
${getUserBadges(profile).map(badge => `- ${badge.description}`).join('\n') || "None"}

Mutual Servers (${mutualGuilds.length}):
${mutualGuilds.map(guild => `- ${guild.name} (${guild.id})`).join('\n') || "None"}

Exported at: ${new Date().toLocaleString()}`;
        filename = `discord-profile-${profile.username}-${profile.id}.txt`;
        mimeType = "text/plain";
    }

    const blob = new Blob([content], { type: mimeType });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    document.body.appendChild(a);
    a.click();
    document.body.removeChild(a);
    URL.revokeObjectURL(url);
}

// Skeleton loader component
function SkeletonLoader({ width = "100%", height = "20px", className = "" }: { width?: string; height?: string; className?: string }) {
    return (
        <div
            className={`${cl("skeleton")} ${className}`}
            style={{
                width,
                height,
                backgroundColor: "var(--background-secondary)",
                borderRadius: "4px",
                animation: "skeleton-loading 1.5s ease-in-out infinite alternate"
            }}
        />
    );
}

function ProfileLookupModal({ modalProps }: any) {
    const [userId, setUserId] = React.useState("");
    const [profile, setProfile] = React.useState<ProfileInfo | null>(null);
    const [mutualGuilds, setMutualGuilds] = React.useState<MutualGuild[]>([]);
    const [error, setError] = React.useState("");
    const [loading, setLoading] = React.useState(false);
    const [searchMode, setSearchMode] = React.useState<"id" | "username">("id");
    const [recentLookups, setRecentLookups] = React.useState<RecentLookup[]>([]);
    const [showRecent, setShowRecent] = React.useState(false);
    const [bulkInput, setBulkInput] = React.useState("");
    const [bulkResults, setBulkResults] = React.useState<ProfileInfo[]>([]);
    const [comparisonProfiles, setComparisonProfiles] = React.useState<ComparisonProfile[]>([]);
    const [showComparison, setShowComparison] = React.useState(false);
    const [activeTab, setActiveTab] = React.useState<"single" | "bulk" | "compare">("single");
    const [guildsViewMode, setGuildsViewMode] = React.useState<"list" | "grid">("list");

    React.useEffect(() => {
        setRecentLookups(getRecentLookups());
    }, []);

    // Keyboard shortcuts
    React.useEffect(() => {
        const handleKeyDown = (e: KeyboardEvent) => {
            if (e.ctrlKey || e.metaKey) {
                switch (e.key) {
                    case "Enter":
                        e.preventDefault();
                        if (userId.trim()) {
                            fetchProfile();
                        }
                        break;
                    case "k":
                        e.preventDefault();
                        document.querySelector<HTMLInputElement>(`.${cl("input")}`)?.focus();
                        break;
                    case "e":
                        e.preventDefault();
                        if (profile) {
                            exportProfileData(profile, mutualGuilds);
                        }
                        break;
                    case "r":
                        e.preventDefault();
                        setShowRecent(!showRecent);
                        break;
                }
            }
        };

        document.addEventListener("keydown", handleKeyDown);
        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [userId, profile, mutualGuilds, showRecent]);

    const searchByUsername = async (username: string) => {
        try {
            // Try to find user in current guild members first
            const currentGuildId = GuildStore.getGuildId();
            if (currentGuildId) {
                const guild = GuildStore.getGuild(currentGuildId);
                if (guild) {
                    const members = GuildStore.getMembers(currentGuildId);
                    for (const member of members) {
                        const user = UserStore.getUser(member.userId);
                        if (user && (
                            user.username.toLowerCase() === username.toLowerCase() ||
                            user.globalName?.toLowerCase() === username.toLowerCase()
                        )) {
                            return user.id;
                        }
                    }
                }
            }

            // Try to find in all cached users
            const allUsers = UserStore.getUsers();
            for (const [userId, user] of Object.entries(allUsers)) {
                if (user.username.toLowerCase() === username.toLowerCase() ||
                    user.globalName?.toLowerCase() === username.toLowerCase()) {
                    return userId;
                }
            }

            // If not found, show helpful message
            showToast("Username not found in cached users. Try using the user ID instead.", Toasts.Type.MESSAGE);
            return null;
        } catch (error) {
            console.error("Username search failed:", error);
            return null;
        }
    };

    const fetchProfile = async (targetUserId?: string) => {
        const searchId = targetUserId || userId.trim();
        if (!searchId) {
            setError("Please enter a user ID or username");
            return;
        }

        setLoading(true);
        setError("");
        setProfile(null);
        setMutualGuilds([]);

        try {
            // Check cache first
            const cached = profileCache.get(searchId);
            if (cached && Date.now() - cached.timestamp < CACHE_DURATION) {
                setProfile(cached.data);
                setMutualGuilds(cached.mutualGuilds);
                setLoading(false);
                return;
            }

            let actualUserId = searchId;

            // If searching by username, try to resolve to ID
            if (searchMode === "username" && !targetUserId) {
                const resolvedId = await searchByUsername(searchId);
                if (!resolvedId) {
                    setError("Could not find user with that username");
                    setLoading(false);
                    return;
                }
                actualUserId = resolvedId;
            }

            // Fetch user profile
            const userProfile = await fetchUserProfile(actualUserId);
            if (!userProfile || !userProfile.user) {
                // Try alternative approach for users that might exist but have private profiles
                try {
                    const basicUser = UserStore.getUser(actualUserId);
                    if (basicUser) {
                        // Create a basic profile from cached user data
                        const basicProfile: ProfileInfo = {
                            id: basicUser.id,
                            username: basicUser.username,
                            discriminator: basicUser.discriminator,
                            global_name: basicUser.globalName,
                            avatar: basicUser.avatar,
                            bot: basicUser.bot || false,
                            flags: basicUser.publicFlags || 0,
                            banner: null,
                            accentColor: null,
                            premium_type: 0,
                        };
                        
                        setProfile(basicProfile);
                        setMutualGuilds([]);
                        saveRecentLookup(basicProfile);
                        setRecentLookups(getRecentLookups());
                        showToast("Showing basic profile info (full profile may be private)", Toasts.Type.MESSAGE);
                        setLoading(false);
                        return;
                    }
                } catch (fallbackError) {
                    console.warn("Fallback profile fetch failed:", fallbackError);
                }
                
                setError("User not found or profile is private. Make sure the user ID is correct and the user exists.");
                setLoading(false);
                return;
            }

            const profileData: ProfileInfo = {
                id: userProfile.userId,
                username: userProfile.user.username,
                discriminator: userProfile.user.discriminator,
                global_name: userProfile.user.globalName,
                avatar: userProfile.user.avatar,
                bot: userProfile.user.bot || false,
                flags: userProfile.user.publicFlags || 0,
                banner: userProfile.banner,
                accentColor: userProfile.accentColor,
                premium_type: userProfile.premiumType,
            };

            // Fetch mutual guilds
            let guilds: MutualGuild[] = [];
            try {
                const mutualResponse = await RestAPI.get({
                    url: Constants.Endpoints.USER_PROFILE_MUTUAL_GUILDS(actualUserId)
                });
                guilds = mutualResponse.body.map((guild: any) => ({
                    id: guild.id,
                    name: guild.name,
                    icon: guild.icon,
                }));
            } catch (guildError) {
                console.warn("Failed to fetch mutual guilds:", guildError);
            }

            // Cache the results
            profileCache.set(actualUserId, {
                data: profileData,
                mutualGuilds: guilds,
                timestamp: Date.now()
            });

            setProfile(profileData);
            setMutualGuilds(guilds);
            saveRecentLookup(profileData);
            setRecentLookups(getRecentLookups());

        } catch (err: any) {
            console.error("Profile lookup failed:", err);
            setError(err.message || "Failed to fetch profile");
        } finally {
            setLoading(false);
        }
    };

    const handleBulkLookup = async () => {
        const ids = bulkInput.split(/[\n,]/).map(id => id.trim()).filter(Boolean);
        if (ids.length === 0) {
            setError("Please enter at least one user ID");
            return;
        }

        setLoading(true);
        setBulkResults([]);
        const results: ProfileInfo[] = [];

        for (const id of ids.slice(0, 10)) { // Limit to 10 to avoid rate limits
            try {
                const userProfile = await fetchUserProfile(id);
                if (userProfile && userProfile.user) {
                    results.push({
                        id: userProfile.userId,
                        username: userProfile.user.username,
                        discriminator: userProfile.user.discriminator,
                        global_name: userProfile.user.globalName,
                        avatar: userProfile.user.avatar,
                        bot: userProfile.user.bot || false,
                        flags: userProfile.user.publicFlags || 0,
                        banner: userProfile.banner,
                        accentColor: userProfile.accentColor,
                        premium_type: userProfile.premiumType,
                    });
                }
            } catch (error) {
                console.warn(`Failed to fetch profile for ${id}:`, error);
            }
        }

        setBulkResults(results);
        setLoading(false);
    };

    const addToComparison = (profileData: ProfileInfo, guilds: MutualGuild[]) => {
        if (comparisonProfiles.length >= 3) {
            showToast("Maximum 3 profiles can be compared", Toasts.Type.MESSAGE);
            return;
        }

        const exists = comparisonProfiles.some(cp => cp.profile.id === profileData.id);
        if (exists) {
            showToast("Profile already in comparison", Toasts.Type.MESSAGE);
            return;
        }

        setComparisonProfiles(prev => [...prev, { profile: profileData, mutualGuilds: guilds }]);
        showToast("Added to comparison", Toasts.Type.SUCCESS);
    };

    const removeFromComparison = (profileId: string) => {
        setComparisonProfiles(prev => prev.filter(cp => cp.profile.id !== profileId));
    };

    const handleAddFriend = async () => {
        if (!profile) return;

        try {
            await RestAPI.put({
                url: Constants.Endpoints.RELATIONSHIPS(profile.id),
                body: { type: 1 }
            });
            showToast("Friend request sent!", Toasts.Type.SUCCESS);
        } catch (error) {
            console.error("Failed to send friend request:", error);
            showToast("Failed to send friend request", Toasts.Type.FAILURE);
        }
    };

    const openUserProfile = () => {
        if (!profile) return;
        FluxDispatcher.dispatch({
            type: "USER_PROFILE_MODAL_OPEN",
            userId: profile.id,
        });
    };

    const getAvatarUrl = (user: ProfileInfo, size = 128) => {
        if (!user.avatar) {
            const defaultAvatarNum = parseInt(user.discriminator) % 5;
            return `https://cdn.discordapp.com/embed/avatars/${defaultAvatarNum}.png`;
        }
        const extension = user.avatar.startsWith("a_") ? "gif" : "png";
        return `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${extension}?size=${size}`;
    };

    const getGuildIconUrl = (guild: MutualGuild, size = 64) => {
        if (!guild.icon) return null;
        const extension = guild.icon.startsWith("a_") ? "gif" : "png";
        return `https://cdn.discordapp.com/icons/${guild.id}/${guild.icon}.${extension}?size=${size}`;
    };

    const bannerUrl = profile ? getBannerUrl(profile.id, profile.banner) : null;
    const badges = profile ? getUserBadges(profile) : [];
    const accountCreated = profile ? getAccountCreationDate(profile.id) : null;

    return (
        <ModalRoot {...modalProps} className={cl("modal")}>
            <style>{`
                .${cl("modal")} {
                    width: 600px;
                    max-width: 90vw;
                }
                .${cl("content")} {
                    padding: 16px;
                    max-height: 80vh;
                    overflow-y: auto;
                }
                .${cl("input-container")} {
                    display: flex;
                    gap: 8px;
                    margin-bottom: 16px;
                    align-items: center;
                }
                .${cl("input")} {
                    flex: 1;
                    padding: 8px 12px;
                    border: 1px solid var(--background-modifier-accent);
                    border-radius: 4px;
                    background: var(--input-background);
                    color: var(--text-normal);
                }
                .${cl("mode-toggle")} {
                    padding: 6px 12px;
                    border: 1px solid var(--background-modifier-accent);
                    border-radius: 4px;
                    background: var(--background-secondary);
                    color: var(--text-normal);
                    cursor: pointer;
                    font-size: 12px;
                }
                .${cl("mode-toggle")}:hover {
                    background: var(--background-modifier-hover);
                }
                .${cl("recent-toggle")} {
                    padding: 4px 8px;
                    border: 1px solid var(--background-modifier-accent);
                    border-radius: 4px;
                    background: var(--background-secondary);
                    color: var(--text-normal);
                    cursor: pointer;
                    font-size: 11px;
                }
                .${cl("recent-list")} {
                    background: var(--background-secondary);
                    border-radius: 4px;
                    padding: 8px;
                    margin-bottom: 16px;
                    max-height: 150px;
                    overflow-y: auto;
                }
                .${cl("recent-item")} {
                    padding: 4px 8px;
                    cursor: pointer;
                    border-radius: 3px;
                    font-size: 13px;
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                }
                .${cl("recent-item")}:hover {
                    background: var(--background-modifier-hover);
                }
                .${cl("recent-clear")} {
                    color: var(--text-danger);
                    font-size: 11px;
                    cursor: pointer;
                    padding: 2px 4px;
                }
                .${cl("profile-card")} {
                    background: var(--background-secondary);
                    border-radius: 8px;
                    overflow: hidden;
                    margin-bottom: 16px;
                }
                .${cl("banner")} {
                    width: 100%;
                    height: 120px;
                    background: linear-gradient(135deg, var(--brand-experiment), var(--brand-experiment-560));
                    position: relative;
                    background-size: cover;
                    background-position: center;
                }
                .${cl("profile-header")} {
                    padding: 16px;
                    position: relative;
                    margin-top: -40px;
                }
                .${cl("avatar")} {
                    width: 80px;
                    height: 80px;
                    border-radius: 50%;
                    border: 4px solid var(--background-secondary);
                    margin-bottom: 12px;
                }
                .${cl("user-info")} {
                    margin-bottom: 16px;
                }
                .${cl("display-name")} {
                    font-size: 20px;
                    font-weight: 600;
                    color: var(--header-primary);
                    margin-bottom: 4px;
                }
                .${cl("username")} {
                    font-size: 14px;
                    color: var(--header-secondary);
                    margin-bottom: 2px;
                }
                .${cl("user-id")} {
                    font-size: 12px;
                    color: var(--text-muted);
                    font-family: monospace;
                }
                .${cl("bot-tag")} {
                    display: inline-block;
                    background: var(--brand-experiment);
                    color: white;
                    padding: 2px 6px;
                    border-radius: 3px;
                    font-size: 10px;
                    font-weight: 500;
                    margin-left: 8px;
                    text-transform: uppercase;
                }
                .${cl("info-grid")} {
                    display: grid;
                    grid-template-columns: 1fr 1fr;
                    gap: 12px;
                    margin-bottom: 16px;
                }
                .${cl("info-item")} {
                    background: var(--background-primary);
                    padding: 12px;
                    border-radius: 6px;
                }
                .${cl("info-label")} {
                    font-size: 12px;
                    color: var(--text-muted);
                    margin-bottom: 4px;
                    text-transform: uppercase;
                    font-weight: 600;
                }
                .${cl("info-value")} {
                    font-size: 14px;
                    color: var(--text-normal);
                    word-break: break-all;
                }
                .${cl("color-swatch")} {
                    width: 20px;
                    height: 20px;
                    border-radius: 50%;
                    display: inline-block;
                    margin-left: 8px;
                    border: 2px solid var(--background-modifier-accent);
                }
                .${cl("badges-section")} {
                    margin-bottom: 16px;
                }
                .${cl("badges-grid")} {
                    display: flex;
                    flex-wrap: wrap;
                    gap: 8px;
                    margin-top: 8px;
                }
                .${cl("badge")} {
                    display: flex;
                    align-items: center;
                    gap: 6px;
                    background: var(--background-primary);
                    padding: 6px 10px;
                    border-radius: 12px;
                    font-size: 12px;
                    color: var(--text-normal);
                }
                .${cl("badge-icon")} {
                    width: 16px;
                    height: 16px;
                }
                .${cl("guilds-header")} {
                    display: flex;
                    justify-content: space-between;
                    align-items: center;
                    margin-bottom: 12px;
                }
                .${cl("view-toggle")} {
                    display: flex;
                    gap: 4px;
                }
                .${cl("guilds-list")} {
                    display: flex;
                    flex-direction: column;
                    gap: 8px;
                    max-height: 300px;
                    overflow-y: auto;
                    background: var(--background-primary);
                    border-radius: 6px;
                    padding: 8px;
                }
                .${cl("guilds-grid")} {
                    display: grid;
                    grid-template-columns: repeat(auto-fill, minmax(140px, 1fr));
                    gap: 12px;
                    max-height: 300px;
                    overflow-y: auto;
                    background: var(--background-primary);
                    border-radius: 6px;
                    padding: 12px;
                }
                .${cl("guild-card")} {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 12px;
                    border-radius: 8px;
                    background: var(--background-secondary);
                    cursor: pointer;
                    transition: all 0.15s ease;
                    border: 1px solid var(--background-modifier-accent);
                }
                .${cl("guild-card")}:hover {
                    background: var(--background-modifier-hover);
                    transform: translateY(-1px);
                    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.1);
                }
                .${cl("guilds-grid")} .${cl("guild-card")} {
                    flex-direction: column;
                    text-align: center;
                    min-height: 120px;
                    padding: 16px 12px;
                }
                .${cl("guild-icon-large")} {
                    width: 48px;
                    height: 48px;
                    border-radius: 50%;
                    background: var(--background-tertiary);
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    font-size: 18px;
                    font-weight: 600;
                    color: var(--text-normal);
                    flex-shrink: 0;
                    position: relative;
                }
                .${cl("guilds-grid")} .${cl("guild-icon-large")} {
                    margin-bottom: 8px;
                    width: 56px;
                    height: 56px;
                    font-size: 20px;
                }
                .${cl("guild-icon-fallback")} {
                    width: 100%;
                    height: 100%;
                    display: flex;
                    align-items: center;
                    justify-content: center;
                    background: linear-gradient(135deg, var(--brand-500), var(--brand-600));
                    border-radius: 50%;
                    color: white;
                    font-weight: 700;
                }
                .${cl("guild-info")} {
                    flex: 1;
                    min-width: 0;
                }
                .${cl("guild-name-container")} {
                    display: flex;
                    align-items: center;
                    gap: 8px;
                    margin-bottom: 4px;
                }
                .${cl("guild-name")} {
                    font-size: 14px;
                    color: var(--text-normal);
                    font-weight: 500;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                    flex: 1;
                }
                .${cl("guilds-grid")} .${cl("guild-name")} {
                    font-size: 13px;
                    text-align: center;
                    white-space: normal;
                    line-height: 1.3;
                    max-height: 2.6em;
                    overflow: hidden;
                    display: -webkit-box;
                    -webkit-line-clamp: 2;
                    -webkit-box-orient: vertical;
                }
                .${cl("guild-badges")} {
                    display: flex;
                    gap: 4px;
                    flex-shrink: 0;
                }
                .${cl("guild-badge")} {
                    padding: 2px 6px;
                    border-radius: 10px;
                    font-size: 10px;
                    font-weight: 600;
                    line-height: 1;
                    cursor: help;
                }
                .${cl("guild-badge")}.owner {
                    background: linear-gradient(135deg, #ffd700, #ffed4e);
                    color: #000;
                }
                .${cl("guild-badge")}.verified {
                    background: linear-gradient(135deg, #5865f2, #7289da);
                    color: white;
                }
                .${cl("guild-badge")}.partnered {
                    background: linear-gradient(135deg, #ff6b6b, #ff8e8e);
                    color: white;
                }
                .${cl("guild-member-count")} {
                    font-size: 12px;
                    color: var(--text-muted);
                    margin-top: 2px;
                }
                .${cl("guild-nickname")} {
                    font-size: 11px;
                    color: var(--text-muted);
                    font-style: italic;
                    margin-top: 2px;
                    overflow: hidden;
                    text-overflow: ellipsis;
                    white-space: nowrap;
                }
                .${cl("actions")} {
                    display: flex;
                    gap: 8px;
                    flex-wrap: wrap;
                }
                .${cl("error")} {
                    color: var(--text-danger);
                    background: var(--background-message-automod);
                    padding: 12px;
                    border-radius: 6px;
                    margin-bottom: 16px;
                    font-size: 14px;
                }
                .${cl("loading")} {
                    text-align: center;
                    padding: 40px;
                    color: var(--text-muted);
                }
                .${cl("tabs")} {
                    display: flex;
                    gap: 8px;
                    margin-bottom: 16px;
                    border-bottom: 1px solid var(--background-modifier-accent);
                }
                .${cl("tab")} {
                    padding: 8px 16px;
                    cursor: pointer;
                    border-bottom: 2px solid transparent;
                    color: var(--text-muted);
                    font-size: 14px;
                }
                .${cl("tab")}.active {
                    color: var(--text-normal);
                    border-bottom-color: var(--brand-experiment);
                }
                .${cl("bulk-input")} {
                    width: 100%;
                    min-height: 100px;
                    padding: 8px;
                    border: 1px solid var(--background-modifier-accent);
                    border-radius: 4px;
                    background: var(--input-background);
                    color: var(--text-normal);
                    resize: vertical;
                    font-family: monospace;
                    font-size: 12px;
                }
                .${cl("bulk-results")} {
                    display: grid;
                    gap: 8px;
                    margin-top: 16px;
                }
                .${cl("bulk-result-item")} {
                    display: flex;
                    align-items: center;
                    gap: 12px;
                    padding: 8px;
                    background: var(--background-secondary);
                    border-radius: 4px;
                }
                .${cl("comparison-grid")} {
                    display: grid;
                    grid-template-columns: repeat(auto-fit, minmax(250px, 1fr));
                    gap: 16px;
                }
                .${cl("comparison-card")} {
                    background: var(--background-secondary);
                    border-radius: 8px;
                    padding: 16px;
                    position: relative;
                }
                .${cl("comparison-remove")} {
                    position: absolute;
                    top: 8px;
                    right: 8px;
                    background: var(--button-danger-background);
                    color: white;
                    border: none;
                    border-radius: 50%;
                    width: 24px;
                    height: 24px;
                    cursor: pointer;
                    font-size: 12px;
                }
                .${cl("keyboard-shortcuts")} {
                    font-size: 11px;
                    color: var(--text-muted);
                    margin-top: 8px;
                    padding: 8px;
                    background: var(--background-secondary);
                    border-radius: 4px;
                }
                @keyframes skeleton-loading {
                    0% { opacity: 0.6; }
                    100% { opacity: 1; }
                }
                .${cl("skeleton")} {
                    animation: skeleton-loading 1.5s ease-in-out infinite alternate;
                }
            `}</style>
            
            <ModalHeader>
                <Text variant="heading-lg/semibold">Profile Lookup</Text>
                <ModalCloseButton />
            </ModalHeader>
            
            <ModalContent className={cl("content")}>
                <div className={cl("tabs")}>
                    <div 
                        className={`${cl("tab")} ${activeTab === "single" ? "active" : ""}`}
                        onClick={() => setActiveTab("single")}
                    >
                        Single Lookup
                    </div>
                    <div 
                        className={`${cl("tab")} ${activeTab === "bulk" ? "active" : ""}`}
                        onClick={() => setActiveTab("bulk")}
                    >
                        Bulk Lookup
                    </div>
                    <div 
                        className={`${cl("tab")} ${activeTab === "compare" ? "active" : ""}`}
                        onClick={() => setActiveTab("compare")}
                    >
                        Compare ({comparisonProfiles.length})
                    </div>
                </div>

                {activeTab === "single" && (
                    <>
                        <div className={cl("input-container")}>
                            <button
                                className={cl("mode-toggle")}
                                onClick={() => setSearchMode(searchMode === "id" ? "username" : "id")}
                            >
                                {searchMode === "id" ? "ID" : "Username"}
                            </button>
                            <TextInput
                                className={cl("input")}
                                placeholder={searchMode === "id" ? "Enter Discord User ID..." : "Enter username..."}
                                value={userId}
                                onChange={setUserId}
                                onKeyDown={(e: React.KeyboardEvent) => {
                                    if (e.key === "Enter" && userId.trim()) {
                                        fetchProfile();
                                    }
                                }}
                            />
                            <Button onClick={() => fetchProfile()} disabled={loading || !userId.trim()}>
                                {loading ? "Loading..." : "Lookup"}
                            </Button>
                            <button
                                className={cl("recent-toggle")}
                                onClick={() => setShowRecent(!showRecent)}
                            >
                                Recent
                            </button>
                        </div>

                        {showRecent && recentLookups.length > 0 && (
                            <div className={cl("recent-list")}>
                                <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", marginBottom: "8px" }}>
                                    <Text variant="text-sm/semibold">Recent Lookups</Text>
                                    <span className={cl("recent-clear")} onClick={() => { clearRecentLookups(); setRecentLookups([]); }}>
                                        Clear All
                                    </span>
                                </div>
                                {recentLookups.map((recent) => (
                                    <div
                                        key={recent.id}
                                        className={cl("recent-item")}
                                        onClick={() => {
                                            setUserId(recent.id);
                                            fetchProfile(recent.id);
                                            setShowRecent(false);
                                        }}
                                    >
                                        <span>{recent.global_name || recent.username}</span>
                                        <span style={{ fontSize: "11px", color: "var(--text-muted)" }}>
                                            {new Date(recent.timestamp).toLocaleDateString()}
                                        </span>
                                    </div>
                                ))}
                            </div>
                        )}

                        <div className={cl("keyboard-shortcuts")}>
                            <strong>Keyboard Shortcuts:</strong> Ctrl+Enter (Search) • Ctrl+K (Focus Input) • Ctrl+E (Export) • Ctrl+R (Recent)
                        </div>
                    </>
                )}

                {activeTab === "bulk" && (
                    <>
                        <div style={{ marginBottom: "16px" }}>
                            <Text variant="text-md/semibold" style={{ marginBottom: "8px" }}>
                                Bulk User Lookup
                            </Text>
                            <Text variant="text-sm/normal" style={{ color: "var(--text-muted)", marginBottom: "8px" }}>
                                Enter user IDs separated by commas or new lines (max 10):
                            </Text>
                            <textarea
                                className={cl("bulk-input")}
                                placeholder="123456789012345678,987654321098765432,..."
                                value={bulkInput}
                                onChange={(e) => setBulkInput(e.target.value)}
                            />
                            <Button 
                                onClick={handleBulkLookup} 
                                disabled={loading || !bulkInput.trim()}
                                style={{ marginTop: "8px" }}
                            >
                                {loading ? "Loading..." : "Lookup All"}
                            </Button>
                        </div>

                        {bulkResults.length > 0 && (
                            <div className={cl("bulk-results")}>
                                <Text variant="text-md/semibold" style={{ marginBottom: "8px" }}>
                                    Results ({bulkResults.length}):
                                </Text>
                                {bulkResults.map((result) => (
                                    <div key={result.id} className={cl("bulk-result-item")}>
                                        <img
                                            src={getAvatarUrl(result, 32)}
                                            alt="Avatar"
                                            style={{ width: "32px", height: "32px", borderRadius: "50%" }}
                                        />
                                        <div style={{ flex: 1 }}>
                                            <div style={{ fontWeight: "600" }}>
                                                {result.global_name || result.username}
                                            </div>
                                            <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                                                {result.username}#{result.discriminator} • {result.id}
                                            </div>
                                        </div>
                                        <Button
                                            size={Button.Sizes.SMALL}
                                            onClick={() => {
                                                setUserId(result.id);
                                                setActiveTab("single");
                                                fetchProfile(result.id);
                                            }}
                                        >
                                            View
                                        </Button>
                                    </div>
                                ))}
                            </div>
                        )}
                    </>
                )}

                {activeTab === "compare" && (
                    <div>
                        <Text variant="text-md/semibold" style={{ marginBottom: "16px" }}>
                            Profile Comparison ({comparisonProfiles.length}/3)
                        </Text>
                        
                        {comparisonProfiles.length === 0 ? (
                            <div style={{ textAlign: "center", padding: "40px", color: "var(--text-muted)" }}>
                                No profiles to compare. Look up profiles and add them to comparison.
                            </div>
                        ) : (
                            <div className={cl("comparison-grid")}>
                                {comparisonProfiles.map((cp) => (
                                    <div key={cp.profile.id} className={cl("comparison-card")}>
                                        <button
                                            className={cl("comparison-remove")}
                                            onClick={() => removeFromComparison(cp.profile.id)}
                                        >
                                            ×
                                        </button>
                                        
                                        <div style={{ textAlign: "center", marginBottom: "12px" }}>
                                            <img
                                                src={getAvatarUrl(cp.profile, 64)}
                                                alt="Avatar"
                                                style={{ width: "64px", height: "64px", borderRadius: "50%" }}
                                            />
                                            <div style={{ fontWeight: "600", marginTop: "8px" }}>
                                                {cp.profile.global_name || cp.profile.username}
                                            </div>
                                            <div style={{ fontSize: "12px", color: "var(--text-muted)" }}>
                                                {cp.profile.username}#{cp.profile.discriminator}
                                            </div>
                                        </div>

                                        <div style={{ fontSize: "12px", lineHeight: "1.4" }}>
                                            <div><strong>Created:</strong> {formatDate(getAccountCreationDate(cp.profile.id))}</div>
                                            <div><strong>Bot:</strong> {cp.profile.bot ? "Yes" : "No"}</div>
                                            <div><strong>Banner:</strong> {cp.profile.banner ? "Yes" : "No"}</div>
                                            <div><strong>Badges:</strong> {getUserBadges(cp.profile).length}</div>
                                            <div><strong>Mutual Servers:</strong> {cp.mutualGuilds.length}</div>
                                        </div>
                                    </div>
                                ))}
                            </div>
                        )}
                    </div>
                )}

                {error && (
                    <div className={cl("error")}>
                        {error}
                    </div>
                )}

                {loading && activeTab === "single" && (
                    <div className={cl("loading")}>
                        <div className={cl("profile-card")}>
                            <div className={cl("banner")} style={{ background: "var(--background-secondary)" }}>
                                <SkeletonLoader width="100%" height="120px" />
                            </div>
                            <div className={cl("profile-header")}>
                                <SkeletonLoader width="80px" height="80px" className={cl("avatar")} />
                                <div className={cl("user-info")}>
                                    <SkeletonLoader width="200px" height="24px" style={{ marginBottom: "8px" }} />
                                    <SkeletonLoader width="150px" height="16px" style={{ marginBottom: "4px" }} />
                                    <SkeletonLoader width="120px" height="14px" />
                                </div>
                                <div className={cl("info-grid")}>
                                    <SkeletonLoader width="100%" height="60px" />
                                    <SkeletonLoader width="100%" height="60px" />
                                    <SkeletonLoader width="100%" height="60px" />
                                    <SkeletonLoader width="100%" height="60px" />
                                </div>
                            </div>
                        </div>
                    </div>
                )}

                {profile && !loading && activeTab === "single" && (
                    <div className={cl("profile-card")}>
                        {bannerUrl ? (
                            <div 
                                className={cl("banner")} 
                                style={{ 
                                    backgroundImage: `url(${bannerUrl})`,
                                    border: profile.accentColor ? `3px solid #${profile.accentColor.toString(16).padStart(6, '0')}` : undefined
                                }}
                            />
                        ) : (
                            <div 
                                className={cl("banner")} 
                                style={{ 
                                    background: profile.accentColor 
                                        ? `#${profile.accentColor.toString(16).padStart(6, '0')}` 
                                        : "linear-gradient(135deg, var(--brand-experiment), var(--brand-experiment-560))"
                                }}
                            />
                        )}
                        
                        <div className={cl("profile-header")}>
                            <img
                                src={getAvatarUrl(profile)}
                                alt="Avatar"
                                className={cl("avatar")}
                            />
                            
                            <div className={cl("user-info")}>
                                <div className={cl("display-name")}>
                                    {profile.global_name || profile.username}
                                    {profile.bot && <span className={cl("bot-tag")}>Bot</span>}
                                </div>
                                <div className={cl("username")}>
                                    {profile.username}#{profile.discriminator}
                                </div>
                                <div className={cl("user-id")}>
                                    ID: {profile.id}
                                </div>
                            </div>

                            <div className={cl("info-grid")}>
                                <div className={cl("info-item")}>
                                    <div className={cl("info-label")}>Account Created</div>
                                    <div className={cl("info-value")}>
                                        {accountCreated ? formatDate(accountCreated) : "Unknown"}
                                    </div>
                                </div>
                                <div className={cl("info-item")}>
                                    <div className={cl("info-label")}>Account Type</div>
                                    <div className={cl("info-value")}>
                                        {profile.bot ? "Bot" : "User"}
                                    </div>
                                </div>
                                <div className={cl("info-item")}>
                                    <div className={cl("info-label")}>Banner</div>
                                    <div className={cl("info-value")}>
                                        {profile.banner ? "Yes" : "No"}
                                    </div>
                                </div>
                                <div className={cl("info-item")}>
                                    <div className={cl("info-label")}>Accent Color</div>
                                    <div className={cl("info-value")}>
                                        {profile.accentColor ? (
                                            <>
                                                #{profile.accentColor.toString(16).padStart(6, '0')}
                                                <span 
                                                    className={cl("color-swatch")}
                                                    style={{ backgroundColor: `#${profile.accentColor.toString(16).padStart(6, '0')}` }}
                                                />
                                            </>
                                        ) : "None"}
                                    </div>
                                </div>
                            </div>

                            {badges.length > 0 && (
                                <div className={cl("badges-section")}>
                                    <Text variant="text-md/semibold">Profile Badges</Text>
                                    <div className={cl("badges-grid")}>
                                        {badges.map((badge) => (
                                            <div key={badge.id} className={cl("badge")} title={badge.description}>
                                                <img
                                                    src={`https://cdn.discordapp.com/badge-icons/${badge.icon}.png`}
                                                    alt={badge.description}
                                                    className={cl("badge-icon")}
                                                />
                                                <span>{badge.description}</span>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}

                            {mutualGuilds.length > 0 && (
                                <div className={cl("guilds-section")}>
                                    <div className={cl("guilds-header")}>
                                        <Text variant="text-md/semibold">
                                            Mutual Servers ({mutualGuilds.length})
                                        </Text>
                                        <div className={cl("view-toggle")}>
                                            <Button
                                                size={Button.Sizes.SMALL}
                                                color={guildsViewMode === "list" ? Button.Colors.BRAND : Button.Colors.SECONDARY}
                                                onClick={() => setGuildsViewMode("list")}
                                            >
                                                List
                                            </Button>
                                            <Button
                                                size={Button.Sizes.SMALL}
                                                color={guildsViewMode === "grid" ? Button.Colors.BRAND : Button.Colors.SECONDARY}
                                                onClick={() => setGuildsViewMode("grid")}
                                            >
                                                Grid
                                            </Button>
                                        </div>
                                    </div>
                                    <div className={cl(`guilds-${guildsViewMode}`)}>
                                        {mutualGuilds.map((guild) => (
                                            <div key={guild.id} className={cl("guild-card")}>
                                                <div className={cl("guild-icon-large")}>
                                                    {getGuildIconUrl(guild) ? (
                                                        <img
                                                            src={getGuildIconUrl(guild)!}
                                                            alt="Guild Icon"
                                                            style={{ width: "100%", height: "100%", borderRadius: "50%" }}
                                                        />
                                                    ) : (
                                                        <div className={cl("guild-icon-fallback")}>
                                                            {guild.name.charAt(0).toUpperCase()}
                                                        </div>
                                                    )}
                                                </div>
                                                <div className={cl("guild-info")}>
                                                    <div className={cl("guild-name-container")}>
                                                        <span className={cl("guild-name")}>{guild.name}</span>
                                                        <div className={cl("guild-badges")}>
                                                            {guild.owner && (
                                                                <div className={cl("guild-badge", "owner")} title="You own this server">
                                                                    👑
                                                                </div>
                                                            )}
                                                            {guild.features?.includes("VERIFIED") && (
                                                                <div className={cl("guild-badge", "verified")} title="Verified server">
                                                                    ✓
                                                                </div>
                                                            )}
                                                            {guild.features?.includes("PARTNERED") && (
                                                                <div className={cl("guild-badge", "partnered")} title="Partnered server">
                                                                    ⭐
                                                                </div>
                                                            )}
                                                        </div>
                                                    </div>
                                                    {guild.member_count && (
                                                        <div className={cl("guild-member-count")}>
                                                            {guild.member_count.toLocaleString()} members
                                                        </div>
                                                    )}
                                                    {guild.nick && (
                                                        <div className={cl("guild-nickname")}>
                                                            Nickname: {guild.nick}
                                                        </div>
                                                    )}
                                                </div>
                                            </div>
                                        ))}
                                    </div>
                                </div>
                            )}
                        </div>
                    </div>
                )}
            </ModalContent>
            
            <ModalFooter>
                <div className={cl("actions")}>
                    {profile && !loading && activeTab === "single" && (
                        <>
                            <Button onClick={handleAddFriend}>
                                Add Friend
                            </Button>
                            <Button onClick={openUserProfile}>
                                Open Profile
                            </Button>
                            <Button 
                                onClick={() => exportProfileData(profile, mutualGuilds, "json")}
                                color={Button.Colors.SECONDARY}
                            >
                                Export JSON
                            </Button>
                            <Button 
                                onClick={() => exportProfileData(profile, mutualGuilds, "text")}
                                color={Button.Colors.SECONDARY}
                            >
                                Export Text
                            </Button>
                            <Button 
                                onClick={() => addToComparison(profile, mutualGuilds)}
                                color={Button.Colors.SECONDARY}
                                disabled={comparisonProfiles.length >= 3}
                            >
                                Add to Compare
                            </Button>
                        </>
                    )}
                </div>
            </ModalFooter>
        </ModalRoot>
    );
}

export default definePlugin({
    name: "ProfileLookup",
    description: "Lookup Discord user information by ID with enhanced features",
    authors: [Devs.You],
    toolboxActions: {
        "Lookup Profile": () =>
            openModal((props: any) => (
                <ProfileLookupModal modalProps={props} />
            )),
    },
});
