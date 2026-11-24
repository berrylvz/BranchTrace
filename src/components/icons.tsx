import type { SVGProps } from 'react'

type IconProps = SVGProps<SVGSVGElement> & { size?: number }

function Icon({ size = 16, children, ...props }: IconProps) {
  return <svg
    width={size}
    height={size}
    viewBox="0 0 16 16"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.65}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    {...props}
  >{children}</svg>
}

export function GripIcon(props: IconProps) {
  return <Icon {...props} fill="currentColor" stroke="none">
    <circle cx="5.75" cy="4" r="1.05" />
    <circle cx="10.25" cy="4" r="1.05" />
    <circle cx="5.75" cy="8" r="1.05" />
    <circle cx="10.25" cy="8" r="1.05" />
    <circle cx="5.75" cy="12" r="1.05" />
    <circle cx="10.25" cy="12" r="1.05" />
  </Icon>
}

export function ChevronRightIcon(props: IconProps) {
  return <Icon {...props}><path d="M6 3.75 10.25 8 6 12.25" /></Icon>
}

export function CheckIcon(props: IconProps) {
  return <Icon {...props}><path d="M3.25 8.5 6.5 11.75 12.75 4.75" /></Icon>
}

export function MinusIcon(props: IconProps) {
  return <Icon {...props}><path d="M4 8h8" /></Icon>
}

export function PlusIcon(props: IconProps) {
  return <Icon {...props}><path d="M8 3.5v9M3.5 8h9" /></Icon>
}

export function MoreHorizontalIcon(props: IconProps) {
  return <Icon {...props} fill="currentColor" stroke="none">
    <circle cx="3.5" cy="8" r="1.2" />
    <circle cx="8" cy="8" r="1.2" />
    <circle cx="12.5" cy="8" r="1.2" />
  </Icon>
}

export function CloseIcon(props: IconProps) {
  return <Icon {...props}><path d="M4.25 4.25 11.75 11.75M11.75 4.25 4.25 11.75" /></Icon>
}

export function ArrowLeftIcon(props: IconProps) {
  return <Icon {...props}><path d="M10 3.75 5.75 8 10 12.25" /></Icon>
}

export function ArrowRightIcon(props: IconProps) {
  return <Icon {...props}><path d="M6 3.75 10.25 8 6 12.25" /></Icon>
}

export function ProgressArrowIcon(props: IconProps) {
  return <Icon {...props}><path d="M4.75 11.25 11.25 4.75M6.25 4.75h5v5" /></Icon>
}

export function CalendarIcon(props: IconProps) {
  return <Icon {...props}>
    <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2" />
    <path d="M5.25 1.75v2.75M10.75 1.75v2.75M2.25 6.75h11.5" />
  </Icon>
}

export function TrashIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M2.75 4.25h10.5M6 4.25V2.75a.75.75 0 0 1 .75-.75h2.5a.75.75 0 0 1 .75.75v1.5" />
    <path d="M4.25 4.25 4.9 12.6a1.25 1.25 0 0 0 1.25 1.15h3.7a1.25 1.25 0 0 0 1.25-1.15l.65-8.35" />
    <path d="M6.75 7.25v3.75M9.25 7.25v3.75" />
  </Icon>
}

export function SettingsIcon(props: IconProps) {
  return <Icon {...props}>
    <circle cx="8" cy="8" r="2.25" />
    <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.58 3.58l1.06 1.06M11.36 11.36l1.06 1.06M12.42 3.58l-1.06 1.06M4.64 11.36l-1.06 1.06" />
  </Icon>
}

export function ExpandAllIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M4.5 6.25 8 3 11.5 6.25M4.5 9.75 8 13l3.5-3.25" />
  </Icon>
}

export function CollapseAllIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M4.5 3.75 8 7l3.5-3.25M4.5 12.25 8 9l3.5 3.25" />
  </Icon>
}

export function BranchNodeIcon(props: IconProps) {
  return <Icon {...props}>
    <circle cx="4.25" cy="3.75" r="1.5" />
    <circle cx="11.75" cy="12" r="1.5" />
    <circle cx="11.75" cy="5.5" r="1.5" />
    <path d="M4.25 5.25v5.25a1.5 1.5 0 0 0 1.5 1.5h4.5M4.25 5.5h6" />
  </Icon>
}

export function ReminderIcon(props: IconProps) {
  return <Icon {...props}>
    <rect x="2.5" y="2.5" width="11" height="11" rx="2.5" />
    <path d="M5.5 8.25 7.25 10 10.75 6.25" />
  </Icon>
}

export function MonitorIcon(props: IconProps) {
  return <Icon {...props}>
    <rect x="2" y="2.75" width="12" height="8.25" rx="1.5" />
    <path d="M5.5 13.5h5M8 11v2.5" />
  </Icon>
}

export function SunIcon(props: IconProps) {
  return <Icon {...props}>
    <circle cx="8" cy="8" r="2.75" />
    <path d="M8 1.75v1.5M8 12.75v1.5M1.75 8h1.5M12.75 8h1.5M3.58 3.58l1.06 1.06M11.36 11.36l1.06 1.06M12.42 3.58l-1.06 1.06M4.64 11.36l-1.06 1.06" />
  </Icon>
}

export function MoonIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M12.75 9.6A5.25 5.25 0 0 1 6.4 3.25a5.5 5.5 0 1 0 6.35 6.35Z" />
  </Icon>
}

export function CornerDownRightIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M3.5 3.5v4.25a1.5 1.5 0 0 0 1.5 1.5h7.25M9.5 6.5l2.75 2.75L9.5 12" />
  </Icon>
}

export function FolderRootIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M2.25 4.75a1.5 1.5 0 0 1 1.5-1.5h2.6l1.4 1.5h4.5a1.5 1.5 0 0 1 1.5 1.5v5.5a1.5 1.5 0 0 1-1.5 1.5h-8.5a1.5 1.5 0 0 1-1.5-1.5v-7Z" />
  </Icon>
}

export function KeyboardIcon(props: IconProps) {
  return <Icon {...props}>
    <rect x="1.75" y="3.5" width="12.5" height="9" rx="1.75" />
    <path d="M4.5 6.5h1M7.5 6.5h1M10.5 6.5h1M5 9.5h6" />
  </Icon>
}

export function CalendarRangeIcon(props: IconProps) {
  return <Icon {...props}>
    <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2" />
    <path d="M5.25 1.75v2.75M10.75 1.75v2.75M2.25 6.75h11.5M5 9.75h6" />
  </Icon>
}

export function CalendarDaysIcon(props: IconProps) {
  return <Icon {...props}>
    <rect x="2.25" y="3.25" width="11.5" height="10.5" rx="2" />
    <path d="M5.25 1.75v2.75M10.75 1.75v2.75M2.25 6.75h11.5" />
    <circle cx="5.5" cy="9.5" r=".7" fill="currentColor" stroke="none" />
    <circle cx="8" cy="9.5" r=".7" fill="currentColor" stroke="none" />
    <circle cx="10.5" cy="9.5" r=".7" fill="currentColor" stroke="none" />
    <circle cx="5.5" cy="11.75" r=".7" fill="currentColor" stroke="none" />
    <circle cx="8" cy="11.75" r=".7" fill="currentColor" stroke="none" />
  </Icon>
}

export function TrendingUpIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M2.25 11.25 6.25 7.25 8.75 9.75 13.75 4.75" />
    <path d="M10.25 4.75h3.5v3.5" />
  </Icon>
}

export function ClockAlertIcon(props: IconProps) {
  return <Icon {...props}>
    <circle cx="8" cy="8" r="5.75" />
    <path d="M8 4.75V8l2.25 1.5" />
  </Icon>
}

export function SearchIcon(props: IconProps) {
  return <Icon {...props}>
    <circle cx="7.25" cy="7.25" r="4.5" />
    <path d="m10.75 10.75 3 3" />
  </Icon>
}

export function ListFilterIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M2.5 4h11M4.5 8h7M6.5 12h3" />
  </Icon>
}

export function ChevronDownIcon(props: IconProps) {
  return <Icon {...props}><path d="M3.75 6 8 10.25 12.25 6" /></Icon>
}

export function ColumnsIcon(props: IconProps) {
  return <Icon {...props}>
    <rect x="2.25" y="2.75" width="11.5" height="10.5" rx="1.75" />
    <path d="M6.25 2.75v10.5M9.75 2.75v10.5" />
  </Icon>
}

export function ListIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M5.75 4.5h7.5M5.75 8h7.5M5.75 11.5h7.5" />
    <circle cx="3.25" cy="4.5" r=".75" fill="currentColor" stroke="none" />
    <circle cx="3.25" cy="8" r=".75" fill="currentColor" stroke="none" />
    <circle cx="3.25" cy="11.5" r=".75" fill="currentColor" stroke="none" />
  </Icon>
}

export function ExternalLinkIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M9.5 2.75h3.75V6.5M6.75 9.25l6.5-6.5" />
    <path d="M12.25 9.25v2.5a1.5 1.5 0 0 1-1.5 1.5h-6.5a1.5 1.5 0 0 1-1.5-1.5v-6.5a1.5 1.5 0 0 1 1.5-1.5h2.5" />
  </Icon>
}

export function LocateIcon(props: IconProps) {
  return <Icon {...props}>
    <circle cx="8" cy="8" r="3.5" />
    <path d="M8 2v2M8 12v2M2 8h2M12 8h2" />
  </Icon>
}

export function ActivityIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M2 8.5h2.5l1.75-4.5 3 8 2-3.5H14" />
  </Icon>
}

export function SlidersIcon(props: IconProps) {
  return <Icon {...props}>
    <path d="M3 4.5h10M3 8h10M3 11.5h10" />
    <circle cx="6" cy="4.5" r="1.25" fill="var(--color-surface, #fff)" />
    <circle cx="10.5" cy="8" r="1.25" fill="var(--color-surface, #fff)" />
    <circle cx="7" cy="11.5" r="1.25" fill="var(--color-surface, #fff)" />
  </Icon>
}
