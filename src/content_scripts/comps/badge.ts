export type BadgeVariant =
    "primary" | "secondary" |
    "success" | "danger" |
    "warning" | "info";

export default function Badge(content: string, variant: BadgeVariant) {
    const el = document.createElement("span");
    el.classList.add("ecx-badge", `ecx-badge-${variant}`);
    el.textContent = content;
    return el;
}

export function ActionBadge(content: string, variant: BadgeVariant, onClick: () => void) {
    const el = document.createElement("button");
    el.type = "button";
    el.classList.add("ecx-badge", "ecx-badge-action", `ecx-badge-${variant}`);
    el.textContent = content;
    el.addEventListener("click", (event) => {
        event.preventDefault();
        event.stopPropagation();
        onClick();
    });
    return el;
}
