// 标签页：封装 @radix-ui/react-tabs，支持 underline / pills 两种风格
import * as React from "react";
import * as TabsPrimitive from "@radix-ui/react-tabs";
import { cva, type VariantProps } from "class-variance-authority";
import { cn } from "@/lib/utils";

const Tabs = TabsPrimitive.Root;

/** 通过 context 把列表风格传给 Trigger，无需调用方重复指定 */
const TabsVariantContext = React.createContext<"underline" | "pills">("underline");

const tabsListVariants = cva("flex", {
  variants: {
    variant: {
      underline: "gap-1 border-b border-border",
      pills: "gap-1 rounded-lg bg-muted p-1",
    },
  },
  defaultVariants: {
    variant: "underline",
  },
});

interface TabsListProps
  extends React.ComponentPropsWithoutRef<typeof TabsPrimitive.List>,
    VariantProps<typeof tabsListVariants> {}

function TabsList({ className, variant = "underline", ...props }: TabsListProps) {
  return (
    <TabsVariantContext.Provider value={variant ?? "underline"}>
      <TabsPrimitive.List className={cn(tabsListVariants({ variant }), className)} {...props} />
    </TabsVariantContext.Provider>
  );
}

const tabsTriggerVariants = cva(
  "text-sm transition-colors focus-visible:outline-none disabled:pointer-events-none disabled:opacity-50",
  {
    variants: {
      variant: {
        underline:
          "border-b-2 border-transparent px-3 py-2 text-muted-foreground hover:text-foreground data-[state=active]:border-accent data-[state=active]:text-foreground",
        pills:
          "rounded-md px-3 py-1.5 text-muted-foreground hover:text-foreground data-[state=active]:bg-background data-[state=active]:text-foreground",
      },
    },
    defaultVariants: {
      variant: "underline",
    },
  }
);

function TabsTrigger({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Trigger>) {
  const variant = React.useContext(TabsVariantContext);
  return (
    <TabsPrimitive.Trigger
      className={cn(tabsTriggerVariants({ variant }), className)}
      {...props}
    />
  );
}

function TabsContent({
  className,
  ...props
}: React.ComponentPropsWithoutRef<typeof TabsPrimitive.Content>) {
  return (
    <TabsPrimitive.Content
      className={cn("focus-visible:outline-none", className)}
      {...props}
    />
  );
}

export { Tabs, TabsList, TabsTrigger, TabsContent };
