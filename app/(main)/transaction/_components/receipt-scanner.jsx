"use client";

import { useRef, useEffect } from "react";
import { Camera, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { toast } from "sonner";
import useFetch from "@/hooks/use-fetch";
import { scanReceipt } from "@/actions/transaction";


export function ReceiptScanner({ onScanComplete }) {
    const fileInputRef = useRef(null); //* Reference to the file input element

    //* Custom hook to handle receipt scan logic
    const {
        loading: scanReceiptLoading,
        fn: scanReceiptFn,
        data: scannedData,
    } = useFetch(scanReceipt);

    const handleReceiptScan = async (file) => {
        if (file.size > 5 * 1024 * 1024) {
            toast.error("File size should be less than 5MB");
            return;
        }
        await scanReceiptFn(file);
    };

    //* Effect: when scannedData is available and loading is done, notify and return result
    useEffect(() => {
        if (scannedData && !scanReceiptLoading) {
            onScanComplete(scannedData); //* Callback to parent with result
            toast.success("Receipt scanned successfully"); //* Show success toast
        }
    }, [scanReceiptLoading, scannedData]);

    return (
        <div className="flex items-center gap-4">
            <input
                type="file"
                ref={fileInputRef}
                className="hidden"
                accept="image/*"
                capture="environment"
                onChange={(e) => {
                    const file = e.target.files?.[0];
                    if (file) handleReceiptScan(file);
                }}
            />
            <Button
                type="button"
                variant="outline"
                className="w-full h-10 bg-gradient-to-br from-blue-500 via-indigo-500 to-purple-600 animate-gradient hover:opacity-90 transition-opacity text-white hover:text-white"
                onClick={() => fileInputRef.current?.click()}
                disabled={scanReceiptLoading}
            >
                {scanReceiptLoading ? (
                <>
                    <Loader2 className="mr-2 animate-spin" />
                    <span>Scanning Receipt...</span>
                </>
                ) : (
                <>
                    <Camera className="mr-2" />
                    <span>Scan Receipt with AI</span>
                </>
                )}
            </Button>
    </div>
);
}
