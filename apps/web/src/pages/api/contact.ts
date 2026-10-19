
import type { APIRoute } from "astro";
import nodemailer from "nodemailer";
import { createHash } from "node:crypto";
import { contactRatelimit } from "../../lib/rate-limit";

export const prerender = false;

// -----------------------------------------
// CONFIGURATION
// -----------------------------------------

const MAX_LENGTH = {
    name: 100,
    email: 254,
    subject: 150,
    message: 5000,
};

const EMAIL_REGEX = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;

// -----------------------------------------
// JSON RESPONSE HELPER
// -----------------------------------------

function jsonResponse(
    data: Record<string, unknown>,
    status = 200,
    headers: Record<string, string> = {}
): Response {
    return new Response(JSON.stringify(data), {
        status,
        headers: {
            "Content-Type": "application/json; charset=utf-8",
            "Cache-Control": "no-store",
            ...headers,
        },
    });
}

// -----------------------------------------
// POST /api/contact
// -----------------------------------------

export const POST: APIRoute = async ({
    request,
    clientAddress,
}) => {
    try {
        // -------------------------------------
        // 1. CHECK CONTENT TYPE
        // -------------------------------------

        const contentType =
            request.headers.get("content-type") ?? "";

        if (!contentType.includes("application/json")) {
            return jsonResponse(
                {
                    success: false,
                    error: "Invalid content type.",
                },
                415
            );
        }

        // -------------------------------------
        // 2. RATE LIMITING (UPSTASH REDIS)
        // -------------------------------------

        if (!contactRatelimit) {
            console.error("Upstash Redis is not configured");

            return jsonResponse(
                {
                    success: false,
                    error: "Contact service is temporarily unavailable.",
                },
                503
            );
        }

        let clientIP: string;

        try {
            clientIP = clientAddress;

            if (!clientIP) {
                throw new Error("Missing client IP");
            }
        } catch {
            console.error("Unable to identify client IP");

            return jsonResponse(
                {
                    success: false,
                    error: "Unable to process the request.",
                },
                503
            );
        }

        // Hash the IP so Redis does not store it directly
        const identifier = createHash("sha256")
            .update(clientIP)
            .digest("hex");


        try {
            const result = await contactRatelimit.limit(identifier);


            // 1. Si la IP ha superado el límite,
            // siempre devolvemos 429, incluso con cacheBlock.
            if (!result.success && result.reason !== "timeout") {
                const retryAfter = Math.max(
                    1,
                    Math.ceil((result.reset - Date.now()) / 1000)
                );

                return jsonResponse(
                    {
                        success: false,
                        error: "Too many requests. Please try again later.",
                        retryAfter,
                    },
                    429,
                    {
                        "Retry-After": String(retryAfter),
                    }
                );
            }

            // 2. Si Redis no ha respondido a tiempo,
            // devolvemos 503 por seguridad.
            if (result.reason === "timeout") {
                console.error("UPSTASH TIMEOUT");

                return jsonResponse(
                    {
                        success: false,
                        error: "Contact service is temporarily unavailable.",
                    },
                    503
                );
            }

            // 3. Si success === true, continuamos
            // con la validación de Turnstile y el envío.
        } catch (error) {
            console.error("UPSTASH ERROR:", error);

            return jsonResponse(
                {
                    success: false,
                    error: "Contact service is temporarily unavailable.",
                },
                503
            );
        }


        // -------------------------------------
        // 3. READ REQUEST BODY
        // -------------------------------------

        // Reject excessively large requests
        const contentLength = Number(
            request.headers.get("content-length") ?? 0
        );

        if (contentLength > 16_384) {
            return jsonResponse(
                {
                    success: false,
                    error: "Request body is too large.",
                },
                413
            );
        }

        let data: Record<string, unknown>;

        try {
            const rawBody = await request.text();

            if (rawBody.length > 16_384) {
                return jsonResponse(
                    {
                        success: false,
                        error: "Request body is too large.",
                    },
                    413
                );
            }

            const parsed: unknown = JSON.parse(rawBody);

            if (
                !parsed ||
                typeof parsed !== "object" ||
                Array.isArray(parsed)
            ) {
                return jsonResponse(
                    {
                        success: false,
                        error: "Invalid form data.",
                    },
                    400
                );
            }

            data = parsed as Record<string, unknown>;
        } catch {
            return jsonResponse(
                {
                    success: false,
                    error: "Invalid JSON body.",
                },
                400
            );
        }

        // -------------------------------------
        // 4. VALIDATE FORM FIELDS
        // -------------------------------------

        const name = String(data.name ?? "").trim();
        const email = String(data.email ?? "").trim();
        const subject = String(data.subject ?? "").trim();
        const message = String(data.message ?? "").trim();
        const website = String(data.website ?? "").trim();

        if (
            !name ||
            !email ||
            !subject ||
            !message ||
            name.length > MAX_LENGTH.name ||
            email.length > MAX_LENGTH.email ||
            subject.length > MAX_LENGTH.subject ||
            message.length < 10 ||
            message.length > MAX_LENGTH.message ||
            !EMAIL_REGEX.test(email)
        ) {
            return jsonResponse(
                {
                    success: false,
                    error: "Please check the form fields.",
                },
                400
            );
        }

        // -------------------------------------
        // 5. ENVIRONMENT VARIABLES
        // -------------------------------------

        const GMAIL_USER =
            import.meta.env.GMAIL_USER?.trim();

        const GMAIL_APP_PASSWORD =
            import.meta.env.GMAIL_APP_PASSWORD?.replace(/\s/g, "");

        const CONTACT_EMAIL =
            import.meta.env.CONTACT_EMAIL?.trim();

        const TURNSTILE_SECRET_KEY =
            import.meta.env.TURNSTILE_SECRET_KEY?.trim();

        const TURNSTILE_ALLOWED_HOSTNAMES = (
            import.meta.env.TURNSTILE_ALLOWED_HOSTNAMES ??
            "localhost"
        )
            .split(",")
            .map((hostname: string) =>
                hostname.trim().toLowerCase()
            )
            .filter(Boolean);

        if (
            !GMAIL_USER ||
            !GMAIL_APP_PASSWORD ||
            !CONTACT_EMAIL ||
            !TURNSTILE_SECRET_KEY
        ) {
            console.error(
                "Missing contact environment configuration"
            );

            return jsonResponse(
                {
                    success: false,
                    error: "Contact service is not configured.",
                },
                500
            );
        }

        // -------------------------------------
        // 6. VERIFY CLOUDFLARE TURNSTILE
        // -------------------------------------

        const turnstileToken = String(
            data["cf-turnstile-response"] ?? ""
        );

        if (
            !turnstileToken ||
            turnstileToken.length > 2048
        ) {
            return jsonResponse(
                {
                    success: false,
                    error: "Please complete the security verification.",
                },
                400
            );
        }

        let verification: {
            success: boolean;
            hostname?: string;
            "error-codes"?: string[];
        };

        try {
            const verificationResponse = await fetch(
                "https://challenges.cloudflare.com/turnstile/v0/siteverify",
                {
                    method: "POST",
                    headers: {
                        "Content-Type":
                            "application/x-www-form-urlencoded",
                    },
                    body: new URLSearchParams({
                        secret: TURNSTILE_SECRET_KEY,
                        response: turnstileToken,
                    }),
                    signal: AbortSignal.timeout(8000),
                }
            );

            if (!verificationResponse.ok) {
                throw new Error(
                    "Turnstile verification service unavailable"
                );
            }

            verification =
                await verificationResponse.json();
        } catch (error) {
            console.error(
                "Turnstile verification error:",
                error
            );

            return jsonResponse(
                {
                    success: false,
                    error:
                        "Security verification is temporarily unavailable.",
                },
                503
            );
        }

        if (!verification.success) {
            console.warn(
                "Turnstile rejected token:",
                verification["error-codes"]
            );

            return jsonResponse(
                {
                    success: false,
                    error:
                        "Security verification failed. Please try again.",
                },
                403
            );
        }

        // -------------------------------------
        // 7. VERIFY ALLOWED HOSTNAME
        // -------------------------------------

        if (
            !verification.hostname ||
            !TURNSTILE_ALLOWED_HOSTNAMES.includes(
                verification.hostname.toLowerCase()
            )
        ) {
            console.warn(
                "Unexpected Turnstile hostname:",
                verification.hostname
            );

            return jsonResponse(
                {
                    success: false,
                    error: "Security verification failed.",
                },
                403
            );
        }

        // -------------------------------------
        // 8. HONEYPOT
        // -------------------------------------

        // Bots often fill hidden fields.
        // Return a generic success without sending mail.
        if (website) {
            return jsonResponse({
                success: true,
                message: "Message received.",
            });
        }

        // -------------------------------------
        // 9. NODEMAILER TRANSPORT
        // -------------------------------------

        const transporter = nodemailer.createTransport({
            service: "gmail",
            auth: {
                user: GMAIL_USER,
                pass: GMAIL_APP_PASSWORD,
            },
        });

        // -------------------------------------
        // 10. SEND EMAIL
        // -------------------------------------

        await transporter.sendMail({
            from: GMAIL_USER,
            to: CONTACT_EMAIL,

            replyTo: {
                name: name.replace(/[\r\n]/g, " "),
                address: email,
            },

            subject: `[Portfolio] ${subject.replace(
                /[\r\n]/g,
                " "
            )}`,

            text: [
                "New message from your portfolio",
                "",
                `Name: ${name}`,
                `Email: ${email}`,
                `Subject: ${subject}`,
                "",
                "Message:",
                message,
            ].join("\n"),
        });

        // -------------------------------------
        // 11. SUCCESS RESPONSE
        // -------------------------------------

        return jsonResponse({
            success: true,
            message: "Message sent successfully!",
        });
    } catch (error) {
        console.error("Contact form error:", error);

        return jsonResponse(
            {
                success: false,
                error:
                    "Unable to send the message. Please try again.",
            },
            500
        );
    }
};
