import { io, Socket } from "socket.io-client";
import config from "@/app/config";

let socket: Socket | null = null;

/**
 * Singleton Socket.IO connection
 * ใช้ connection เดียวกันทั้งแอป — ไม่สร้างซ้ำทุกหน้า
 */
export function getSocket(): Socket {
    if (!socket) {
        socket = io(config.apiServer, {
            transports: ["websocket", "polling"],
        });
    }
    return socket;
}
