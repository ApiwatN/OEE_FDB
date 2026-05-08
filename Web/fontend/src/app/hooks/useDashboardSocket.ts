"use client";

import { useEffect, useState } from "react";
import { getSocket } from "@/app/lib/socketManager";

export type DashboardSocketEvent<TPayload = unknown> = {
    event: string;
    handler: (payload: TPayload) => void;
};

type UseDashboardSocketOptions<TPayload = unknown> = {
    room?: string;
    events?: DashboardSocketEvent<TPayload>[];
};

export function useDashboardSocket<TPayload = unknown>({
    room = "dashboard",
    events = [],
}: UseDashboardSocketOptions<TPayload> = {}) {
    const [socketConnected, setSocketConnected] = useState(false);
    const [serverTimeStr, setServerTimeStr] = useState("");

    useEffect(() => {
        const socket = getSocket();

        const handleConnect = () => {
            setSocketConnected(true);
            socket.emit("joinRoom", room);
        };
        const handleDisconnect = () => setSocketConnected(false);
        const handleServerTime = (isoStr: string) => {
            const t = new Date(isoStr);
            setServerTimeStr(t.toLocaleTimeString("en-GB", { hour12: false, timeZone: "Asia/Bangkok" }));
        };

        socket.on("connect", handleConnect);
        socket.on("disconnect", handleDisconnect);
        socket.on("server_time", handleServerTime);
        events.forEach(({ event, handler }) => socket.on(event, handler));

        if (socket.connected) handleConnect();

        return () => {
            socket.emit("leaveRoom", room);
            socket.off("connect", handleConnect);
            socket.off("disconnect", handleDisconnect);
            socket.off("server_time", handleServerTime);
            events.forEach(({ event, handler }) => socket.off(event, handler));
        };
    }, [events, room]);

    return { socketConnected, serverTimeStr };
}
