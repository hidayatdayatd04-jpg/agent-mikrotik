import { Menu } from "@/components/icons";
import { Button } from "@/components/ui/button";
import { Sheet, SheetContent, SheetHeader, SheetTitle, SheetTrigger } from "@/components/ui/sheet";
import { NotificationBell } from "../features/notifications/NotificationBell";
import { SidebarContent } from "./SidebarContent";
import { ThemeToggle } from "./ThemeToggle";

export function MobileTopBar(props: {
  mobileOpen: boolean;
  setMobileOpen: (v: boolean) => void;
  search: string;
  setSearch: (v: string) => void;
  conversationId: string | null;
  profileName: string;
  profileUsername: string;
  onLogout: () => void;
}) {
  return (
    <header className="flex h-14 shrink-0 items-center justify-between border-b border-border/60 bg-background/80 px-4 backdrop-blur-md md:hidden">
      <div className="flex items-center gap-2">
        <Sheet open={props.mobileOpen} onOpenChange={props.setMobileOpen}>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="size-9" aria-label="Buka menu navigasi">
              <Menu className="size-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-80 p-0">
            <SheetHeader className="flex flex-row items-center justify-between border-b border-border/60 px-4 py-3 text-left">
              <SheetTitle className="text-sm font-semibold">MikroTik AI Agent</SheetTitle>
              <NotificationBell onNavigate={() => props.setMobileOpen(false)} />
            </SheetHeader>
            <div className="flex h-[calc(100svh-4rem)] flex-col overflow-hidden">
              <SidebarContent
                search={props.search}
                setSearch={props.setSearch}
                activeId={props.conversationId}
                onNavigate={() => props.setMobileOpen(false)}
                profileName={props.profileName}
                profileUsername={props.profileUsername}
                onLogout={props.onLogout}
              />
            </div>
          </SheetContent>
        </Sheet>
        <span className="truncate text-sm font-semibold">MikroTik AI Agent</span>
      </div>
      <ThemeToggle />
    </header>
  );
}
