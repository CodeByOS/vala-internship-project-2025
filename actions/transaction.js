"use server";

import aj from "@/lib/arcjet";
import { prismadb } from "@/lib/prisma";
import { request } from "@arcjet/next";
import { auth } from "@clerk/nextjs/server";
import { GoogleGenerativeAI } from "@google/generative-ai";
import { revalidatePath } from "next/cache";

const genAi = new GoogleGenerativeAI(process.env.GEMINI_API_KEY);

const serializeAmount = (obj) => ({
    ...obj,
    amount: obj.amount.toNumber(),
});

export async function addTransaction(data) {
    try {
        const { userId } = await auth();
        if(!userId) {
            throw new Error("User not authenticated");
        }

        //* GET REQUEST DATA FOR ARCJET
        const req = await request();
         // Check rate limit
        const decision = await aj.protect(req, {
            userId,
            requested: 1, // Specify how many tokens to consume
        });

        if (decision.isDenied()) {
            if (decision.reason.isRateLimit()) {
                const { remaining, reset } = decision.reason;
                console.error({
                code: "RATE_LIMIT_EXCEEDED",
                details: {
                    remaining,
                    resetInSeconds: reset,
                },
            });

            throw new Error("Too many requests. Please try again later.");
        }
            throw new Error("Request blocked");
        }

        const user = await prismadb.user.findUnique({
            where: { clerkUserId: userId },
        })

        const account = await prismadb.account.findUnique({
            where: {
                id: data.accountId,
                userId: user.id,
            }
        })
        if(!account) {
            throw new Error("Account not found or does not belong to user");
        }

        const balanceChange = data.type === 'EXPENSE' ? -data.amount : data.amount;
        const newBalance = account.balance.toNumber() + balanceChange;

        const transaction = await prismadb.$transaction(async (tx) => {
            const newTransaction = await tx.transaction.create({
                data: {
                    ...data,
                    userId: user.id,
                    nextRecurringDate: data.isRecurring && data.recurringInterval
                        ? calculateNextRecurringDate(data.data, data.recurringInterval)
                        : null,
                }
            });

            await tx.account.update({
                where: { id: data.accountId },
                data: { balance: newBalance },
            });

            return newTransaction;
        });

        revalidatePath("/dashboard");
        revalidatePath(`/account/${transaction.accountId}`);

        return { success: true , data: serializeAmount(transaction) };
    } catch (err) {
        throw new Error(err.message);
    }

}

//* Function to calculate next recurring date

function calculateNextRecurringDate(startDate, interval) {
    const date = new Date(startDate);

    switch (interval) {
        case "DAILY":
            date.setDate(date.getDate() + 1);
            break;
        case "WEEKLY":
            date.setDate(date.getDate() + 7);
            break;
        case "MONTHLY":
            date.setMonth(date.getMonth() + 1);
            break;
        case "YEARLY":
            date.setFullYear(date.getFullYear() + 1);
            break;
    }

    return date;
}

export async function scanReceipt(file) {
    try {
        const model = genAi.getGenerativeModel({ model: "gemini-1.5-flash" });
        //* Convert file to ArrayBuffer
        const arrayBuffer = await file.arrayBuffer();

        //* Convert ArrayBuffer to Base64
        const base64String = Buffer.from(arrayBuffer).toString('base64');

        const prompt = `
            Analyze this receipt image and extract the following information in JSON format:
            - Total amount (just the number)
            - Date (in ISO format)
            - Description or items purchased (brief summary)
            - Merchant/store name
            - Suggested category (one of: housing,transportation,groceries,utilities,entertainment,food,shopping,healthcare,education,personal,travel,insurance,gifts,bills,other-expense )
            
            Only respond with valid JSON in this exact format:
            {
                "amount": number,
                "date": "ISO date string",
                "description": "string",
                "merchantName": "string",
                "category": "string"
            }

            If its not a recipt, return an empty object.
        `

        const result = await model.generateContent([
            {
                inlineData: {
                    data: base64String,
                    mimeType: file.type,
                },
            },
            prompt
        ]);

        const response = await result.response;
        const textResult = response.text();

        const cleanResult = textResult.replace(/```(?:json)?\n?/g, "").trim();

        try {
            const data = JSON.parse(cleanResult);
            return {
                amount: parseFloat(data.amount),
                date: new Date(data.date),
                description: data.description,
                category: data.category,
                merchantName: data.merchantName,
            };
        } catch (err) {
            console.error("Error parsing JSON response:", err);
            throw new Error("Invalid response format from Gemini");
        }
    } catch (err) {
        console.error("Error scanning receipt:", err);
        throw new Error("Failed to scan receipt");
    }
}

export async function getTransaction(id) {
    try {
        const { userId } = await auth();
        if(!userId) {
            throw new Error("User not authenticated");
        }

        const user = await prismadb.user.findUnique({
            where: { clerkUserId: userId },
        });
        if(!user) {
            throw new Error("User not found");
        }
        const transaction = await prismadb.transaction.findUnique({
            where: {
                id,
                userId: user.id,
            },
        });
        if(!transaction) {
            throw new Error("Transaction not found or does not belong to user");
        }
        return serializeAmount(transaction);

    } catch (err) {
        console.error("Error fetching transaction:", err);
        throw new Error(err.message || "Failed to fetch transaction");
    }
}

export async function updateTransaction(id, data) {
    try {
        const { userId } = await auth();
        if(!userId) {
            throw new Error("User not authenticated");
        }

        const user = await prismadb.user.findUnique({
            where: { clerkUserId: userId },
        });
        if(!user) {
            throw new Error("User not found");
        }

        //* Get original transaction to calculate balance change
        const originalTransaction = await prismadb.transaction.findUnique({
            where: {
                id,
                userId: user.id,
            },
            include: {
                account: true, //! Include account to get current balance
            },
        });

        if(!originalTransaction) {
            throw new Error("Transaction not found or does not belong to user");
        }

        //* Calculate balance changes
        const oldBalanceChange = originalTransaction.type === 'EXPENSE' ? -originalTransaction.amount.toNumber() : originalTransaction.amount.toNumber();

        const newBalanceChange = data.type === 'EXPENSE' ? -data.amount : data.amount;

        const balanceChange = newBalanceChange - oldBalanceChange;

        //* Update transaction and account balance in a transaction
        const transaction = await prismadb.$transaction(async (tx) => {
            const updatedTransaction = await tx.transaction.update({
                where: { id, userId: user.id },
                data: {
                    ...data,
                    nextRecurringDate: data.isRecurring && data.recurringInterval
                        ? calculateNextRecurringDate(data.date, data.recurringInterval)
                        : null,
                },
            });

            //* Update account balance
            await tx.account.update({
                where: { id: data.accountId },
                data: { 
                    balance: {
                        increment: balanceChange,
                    }
                },
            });

            return updatedTransaction;
        })

        revalidatePath("/dashboard");
        revalidatePath(`/account/${data.accountId}`);

        return { success: true, data: serializeAmount(transaction) };
    } catch (err) {
        throw new Error(err.message || "Failed to update transaction");
    }
}