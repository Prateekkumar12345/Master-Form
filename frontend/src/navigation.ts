export type View = "overview" | "forms" | "versions";

export const NAV_ITEMS: {
  id: View;
  label: string;
  hint: string;
  icon: "home" | "forms" | "history";
}[] = [
  {
    id: "overview",
    label: "Overview",
    hint: "Your workspace at a glance",
    icon: "home",
  },
  {
    id: "forms",
    label: "Form library",
    hint: "Create, edit and publish",
    icon: "forms",
  },
  {
    id: "versions",
    label: "Version history",
    hint: "Switch saved versions",
    icon: "history",
  },
];
