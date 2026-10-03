import { getAuth, clerkClient } from "@clerk/express"
import {sql} from "../config/db.js"

export const protect = async (req, res, next) =>{
    const auth = getAuth(req);
    const userId = auth?.userId || req.auth?.userId;

    if(!userId){
        return res.status(401).json({ error: "Not authorized, authentication required" });
    }

    req.user = {id: userId};

    const userActivePlan = auth.has({plan: "premium"}) ? "premium" : "free";

    let users = await sql`SELECT name, plan FROM users WHERE id = ${userId}`

    if(!users || users.length === 0){
        try {
            const clerkUser = await clerkClient.users.getUser(userId);
            const name = [clerkUser.firstName, clerkUser.lastName].filter(Boolean).join(" ") || "User";
            const email = clerkUser.emailAddresses?.[0]?.emailAddress || `${userId}@meetup.local`;
            const image = clerkUser.imageUrl || "";

            await sql`
                INSERT INTO users (id, name, email, image, plan)
                VALUES (${userId}, ${name}, ${email}, ${image}, ${userActivePlan})
                ON CONFLICT (id) DO UPDATE SET
                    plan = EXCLUDED.plan,
                    name = EXCLUDED.name,
                    updated_at = NOW()
            `;
            users = await sql`SELECT name, plan FROM users WHERE id = ${userId}`;
        } catch (syncErr) {
            console.error("Auto-syncing Clerk user to DB failed:", syncErr);
        }
    } else {
        const userPlan = users[0]?.plan;
        if(userActivePlan !== userPlan){
            await sql`UPDATE users SET plan = ${userActivePlan} WHERE id = ${userId}`
        }
    }

    next()
}