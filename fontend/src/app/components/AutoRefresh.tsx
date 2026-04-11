"use client";

import { useEffect, useRef } from "react";
import { getSocket } from "@/app/lib/socketManager";

export default function AutoRefresh() {
    const hasConnectedBefore = useRef(false);

    // --- 1. Hourly Auto Reload ---
    useEffect(() => {
        const now = new Date();
        const msUntilNextHour = (60 - now.getMinutes()) * 60000 - now.getSeconds() * 1000 - now.getMilliseconds() + 1000; // +1000 to ensure we hit XX:00:01

        const reloadTimer = setTimeout(() => {
            console.log("⏰ Hourly auto-refresh triggered!");
            window.location.reload();
        }, msUntilNextHour);

        return () => clearTimeout(reloadTimer); // Cleanup if unmounted before the hour
    }, []);

    // --- 2. Socket Connection Management ---
    useEffect(() => {
        const socket = getSocket();

        const handleConnect = () => {
            if (hasConnectedBefore.current) {
                console.log("🔄 Backend reconnected! Reloading page to fetch fresh data...");
                setTimeout(() => {
                    window.location.reload();
                }, 1500);
            } else {
                hasConnectedBefore.current = true;
            }
        };

        const handleDisconnect = () => {
            console.warn("⚠️ Backend disconnected! Waiting for reconnection...");
        };

        socket.on("connect", handleConnect);
        socket.on("disconnect", handleDisconnect);

        if (socket.connected) {
            hasConnectedBefore.current = true;
        }

        return () => {
            socket.off("connect", handleConnect);
            socket.off("disconnect", handleDisconnect);
        };
    }, []);

    return null;
}
