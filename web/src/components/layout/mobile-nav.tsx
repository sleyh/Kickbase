"use client";

import { useState } from "react";
import { Menu } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { SidebarNav } from "@/components/layout/sidebar-nav";

/**
 * The desktop sidebar (SidebarNav) is `hidden md:block` - this is the
 * mobile equivalent, a full-height drawer reusing the same nav so the
 * link list only lives in one place. Built on the existing Dialog
 * primitive rather than a dedicated Sheet component, overriding its
 * centered-modal positioning to slide in from the left instead.
 */
export function MobileNav({ isAdmin }: { isAdmin: boolean }) {
  const [open, setOpen] = useState(false);

  return (
    <Dialog open={open} onOpenChange={setOpen}>
      <Button variant="ghost" size="icon" className="md:hidden" onClick={() => setOpen(true)}>
        <Menu className="size-4" />
      </Button>
      <DialogContent className="top-0 left-0 h-full max-h-full w-64 max-w-[80vw] translate-x-0 translate-y-0 rounded-none rounded-r-xl data-open:slide-in-from-left data-closed:slide-out-to-left">
        <DialogHeader className="sr-only">
          <DialogTitle>Menu</DialogTitle>
        </DialogHeader>
        <div onClick={() => setOpen(false)}>
          <SidebarNav isAdmin={isAdmin} />
        </div>
      </DialogContent>
    </Dialog>
  );
}
