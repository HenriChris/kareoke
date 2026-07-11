'use client';

import { ReactNode, useEffect } from "react";

type ModalProps = {
    open: boolean;
    title: string;
    onClose: () => void;
    children: ReactNode;
};

export default function Modal({
    open,
    title,
    onClose,
    children,
}: ModalProps) {
    useEffect(() => {
        if (!open) return;

        const handleKeyDown = (event: KeyboardEvent) => {
            if (event.key === "Escape") {
                onClose();
            }
        };

        document.addEventListener("keydown", handleKeyDown);

        return () => document.removeEventListener("keydown", handleKeyDown);
    }, [open, onClose]);

    if (!open) return null;

    return (
        <div
            className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4 backdrop-blur-sm"
            onClick={onClose}
            aria-modal="true"
            role="dialog"
            aria-labelledby="modal-title"
        >
            <div
                onClick={(e) => e.stopPropagation()}
                className="w-full max-w-md rounded-3xl border border-white/10 bg-neutral-900 shadow-2xl shadow-fuchsia-900/20"
            >
                <header className="flex items-center justify-between border-b border-white/10 px-6 py-4">
                    <h2
                        id="modal-title"
                        className="text-lg font-semibold text-fuchsia-100"
                    >
                        {title}
                    </h2>

                    <button
                        onClick={onClose}
                        className="rounded-lg p-2 text-neutral-400 transition hover:bg-white/10 hover:text-white focus-visible:outline focus-visible:outline-fuchsia-400"
                        aria-label="Close modal"
                    >
                        ✕
                    </button>
                </header>

                <div className="p-6">
                    {children}
                </div>
            </div>
        </div>
    );
}