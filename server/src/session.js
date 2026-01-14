const DEFAULT_COOKIE = "bs_session";

export function getSessionCookieName() {
    return String(process.env.SESSION_COOKIE_NAME || DEFAULT_COOKIE).trim() || DEFAULT_COOKIE;
}

export function buildCookieOptions() {
    const isProd = String(process.env.NODE_ENV || "").toLowerCase() === "production";
    return {
        httpOnly: true,
        signed: true,
        sameSite: "lax",
        secure: isProd, // HTTPS only in production
        path: "/",
        maxAge: 1000 * 60 * 60 * 24 * 14, // 14 days
    };
}

export function setSession(res, sessionObj) {
    const name = getSessionCookieName();
    const value = JSON.stringify(sessionObj || {});
    res.cookie(name, value, buildCookieOptions());
}

export function clearSession(res) {
    const name = getSessionCookieName();
    res.clearCookie(name, { path: "/" });
}

export function readSession(req) {
    const name = getSessionCookieName();
    const raw = req?.signedCookies?.[name];
    if (!raw) return null;

    try {
        const obj = JSON.parse(String(raw));
        if (!obj || typeof obj !== "object") return null;
        return obj;
    } catch {
        return null;
    }
}
