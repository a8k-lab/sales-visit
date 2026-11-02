import { BrowserIcon, TelegramLogoIcon } from "@phosphor-icons/react";
import type { SubmissionChannel } from "@sales-visit/contracts";

import { Badge } from "@/components/ui/badge";

export function ChannelBadge({ channel }: { channel: SubmissionChannel }) {
  return (
    <Badge variant="outline">
      {channel === "web" ? <BrowserIcon /> : <TelegramLogoIcon />}
      {channel === "web" ? "Dashboard Web" : "Telegram Bot"}
    </Badge>
  );
}
