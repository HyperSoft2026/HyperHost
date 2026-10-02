import React, { createContext, useContext, useEffect, useState } from 'react';
import { Globe } from 'lucide-react';
import {
  normalizeLocale,
  supportedLocales,
  type SupportedLocale,
} from '../shared/types';

export { supportedLocales, type SupportedLocale };
export type Locale = SupportedLocale;

const STORAGE_KEY = 'hyperhost_locale';

const dictionary = {
  'en-US': {
    localeCode: 'en-US' as SupportedLocale,
    dir: 'ltr' as 'ltr' | 'rtl',
    langName: 'English (US)',
    switchLangLabel: 'العربية (العراق)',
    brandSubtitle: 'Powered by HyperSoft',
    initializing: 'Initializing HyperHost Control Plane...',
    // Login View
    controlPlaneApi: 'Control Plane API',
    online: 'Online',
    checking: 'Checking',
    maxQuotaHeader: 'Max Quota',
    hostsPerUser: 'Hosts / User',
    infraBadgeLeft: 'HyperSoft Cloud Infrastructure',
    infraBadgeRight: 'Control Plane & Runtime Plane Separation',
    heroTitle: 'Professional Discord & Telegram Bot Hosting Platform',
    heroDescription:
      'Deploy and manage isolated application Hosts for Discord bots, Telegram bots, Node.js, Python, Java, Go, and Rust workloads with granular permissions, encrypted environment vaults, and real-time WebSocket console streams.',
    featureIsolatedTitle: 'Isolated Runtime Plane',
    featureIsolatedDesc:
      'Strict separation between the Fastify Control Plane and remote Runtime Nodes managing containers, CPU/RAM/Disk quotas, and network allocations.',
    featureSecurityTitle: 'Zero-Trust Security',
    featureSecurityDesc:
      'Discord OAuth2 identity, AES-256-GCM encrypted secrets, 21 granular collaborator permission scopes, and full audit logging.',
    signInTitle: 'Sign in to HyperHost',
    signInSubtitle: 'Authenticate with your Discord account',
    authUnavailable: 'Authentication Unavailable',
    connectingDiscord: 'Connecting to Discord...',
    continueWithDiscord: 'Continue with Discord OAuth2',
    loginNotificationHint:
      'A security login DM notification will be sent to your Discord account upon sign-in.',
    telemetryTitle: 'Control Plane Telemetry',
    refresh: 'Refresh',
    fastifyServer: 'Fastify API Server',
    postgresPrisma: 'PostgreSQL (Prisma)',
    connected: 'CONNECTED',
    awaitingDatabaseUrl: 'AWAITING DATABASE_URL',
    discordOAuthEnv: 'Discord OAuth2 Env',
    configured: 'CONFIGURED',
    awaitingCredentials: 'AWAITING CREDENTIALS',
    discordLoginNotifyEnv: 'Discord Login DM Bot',
    enabled: 'ENABLED',
    optionalStandby: 'STANDBY',
    connectedRuntimeNodes: 'Connected Runtime Nodes',
    footerLeft: 'HyperHost Control Plane — Powered by HyperSoft',
    footerRight: 'Fastify · Prisma · PostgreSQL · WebSocket · Discord OAuth2',
    // Dashboard & Navigation
    navDashboard: 'Dashboard & Hosts',
    navHostPanel: 'Host Control Panel',
    navAdmin: 'Control Plane Admin',
    accountQuota: 'Account Quota',
    hostsWord: 'Hosts',
    signOut: 'Sign Out',
    controlPlaneHeader: 'HyperHost Control Plane',
    runtimeNodesConnected: 'Runtime Nodes Connected',
    createHost: 'Create Host',
    welcomeUser: 'Welcome',
    dashboardSubtitle:
      'Manage your Discord & Telegram Bot Hosts, monitor Runtime Node connectivity, and configure startup environments.',
    discordLoginSuccessTitle: 'Discord OAuth2 Authentication Verified',
    discordLoginSuccessDesc:
      'Your session is active and a Discord login DM notification has been dispatched to your account.',
    dismiss: 'Dismiss',
    totalHosts: 'Total Hosts',
    onlineHosts: 'Online Hosts',
    offlinePending: 'Offline / Pending',
    cpuUsage: 'CPU Usage',
    noMetricsAvailable: 'No metrics available',
    memoryQuota: 'Memory Quota',
    storageQuota: 'Storage Quota',
    myHosts: 'My Hosts',
    usedOf: 'used',
    noHostsTitle: 'No Hosts Provisioned Yet',
    noHostsDesc:
      'Create your first Discord Bot, Telegram Bot, Node.js, Python, Java, Go, or Rust Host.',
    cpuLimit: 'CPU Limit',
    ramLimit: 'RAM Limit',
    nodeLabel: 'Node',
    runtimeNodeUnavailable: 'Runtime node unavailable',
    manage: 'Manage',
    recentActivity: 'Recent Activity',
    noRecentActivity: 'No recent activity recorded in PostgreSQL.',
    // Create Host Modal
    createNewHostTitle: 'Create New Host',
    quotaUsage: 'Quota usage',
    noLiveNodesNotice:
      'No live Runtime Nodes are currently connected. Your Host will be created in PENDING state until a Runtime Node is attached.',
    hostNameLabel: 'Host Name',
    hostNamePlaceholder: 'e.g. Aegis Discord Bot',
    appTypeLabel: 'Application Type',
    runtimeEnvLabel: 'Runtime Environment',
    runtimeVersionLabel: 'Runtime Version',
    descriptionOptionalLabel: 'Description (Optional)',
    descriptionPlaceholder: 'Brief summary of bot purpose or cluster role',
    targetNodeLabel: 'Target Runtime Node',
    unassignedNodeOption: 'Unassigned — Queue as PENDING until Node is bound',
    cpuLimitPercentLabel: 'CPU Limit (%)',
    memoryLimitMbLabel: 'Memory Limit (MB)',
    diskLimitMbLabel: 'NVMe Disk Limit (MB)',
    cancel: 'Cancel',
    creatingHost: 'Creating Host...',
    // Host Panel Tabs
    tabConsole: 'Console',
    tabFiles: 'Files',
    tabStartup: 'Startup',
    tabNetwork: 'Network',
    tabMetrics: 'Metrics',
    tabManagement: 'Management',
    tabDatabases: 'Databases',
    tabSchedules: 'Schedules',
    tabBackups: 'Backups',
    tabAdministration: 'Administration',
    tabUsers: 'Users',
    tabSettings: 'Settings',
    tabActivity: 'Activity',
    statusLabel: 'Status',
    runtimeLabel: 'Runtime',
    limitsLabel: 'Limits',
    startBtn: 'Start',
    restartBtn: 'Restart',
    stopBtn: 'Stop',
    wsConsoleStream: 'WebSocket Console Stream',
    wsConnected: 'Connected',
    wsConnecting: 'Connecting...',
    clearConsole: 'Clear Console',
    reconnect: 'Reconnect',
    consoleUnavailableDesc:
      'No Runtime Node agent is currently connected to stream stdout/stderr for this Host. Connect a Runtime Node daemon to enable live process execution.',
    stdinPlaceholderConnected: 'Send command to container stdin...',
    stdinPlaceholderDisconnected: 'Runtime node unavailable — stdin disabled',
    sendBtn: 'Send',
    remoteFileManager: 'Remote Node File Manager',
    workingPath: 'Working Path',
    newFileOrFolderPlaceholder: 'New file or folder name',
    createFileBtn: 'Create File',
    createFolderBtn: 'Create Folder',
    fileColName: 'Name',
    fileColType: 'Type',
    fileColSize: 'Size',
    fileColModified: 'Modified',
    fileTypeDir: 'Directory',
    fileTypeFile: 'File',
    filesUnavailableDesc:
      'Host files reside exclusively on isolated Runtime Node volumes and never on the Control Plane web filesystem. Connect the assigned Runtime Node to browse, edit, upload, or download container files.',
    startupVaultTitle: 'Startup Configuration & Encrypted Environment Vault',
    startupVaultDesc:
      'Configure container entrypoint, runtime version, working directory, and AES-256-GCM encrypted variables. Secrets are never exposed in Activity Logs.',
    startupCommandLabel: 'Startup Command',
    startupArgsLabel: 'Arguments (Space-separated)',
    workingDirLabel: 'Container Working Directory',
    envVarsTitle: 'Environment Variables',
    secretLabel: 'Secret',
    plainLabel: 'Plain',
    envKeyPlaceholder: 'KEY_NAME (e.g. DISCORD_TOKEN)',
    envValPlaceholder: 'Secret or configuration value',
    addVariableBtn: 'Add Variable',
    saveStartupBtn: 'Save Startup Configuration',
    networkTitle: 'Network & Node Allocations',
    networkDesc:
      'IP, Port, and Protocol bindings assigned to this Host on its Runtime Node.',
    noAllocations:
      'No network allocations assigned. Assign this Host to a Runtime Node with an available IP/Port pool.',
    netColIp: 'IP Address',
    netColPort: 'Port',
    netColProto: 'Protocol',
    netColRole: 'Role',
    netColStatus: 'Status',
    netRolePrimary: 'Primary',
    netRoleSecondary: 'Secondary',
    metricsTitle: 'Container Resource Telemetry',
    metricsDesc:
      'Real-time CPU, Memory, Disk, Network RX/TX, and Uptime reported by the Runtime Node MetricsCollector.',
    metricsUnavailableDesc:
      'Runtime Node telemetry is currently unavailable. HyperHost never displays fabricated CPU, RAM, or network metrics when a Runtime Node is offline.',
    metricsCpuLoad: 'CPU Load',
    metricsMemoryUsage: 'Memory Usage',
    metricsUptime: 'Uptime',
    managementTitle: 'Process & Container Lifecycle Management',
    managementDesc:
      'Dispatch lifecycle commands to the Runtime Node ProcessManager and ContainerManager. If the Runtime Node is offline, the API returns a structured error rather than faking success.',
    mgmtStartTitle: 'Start Host',
    mgmtStartDesc: 'Boot container entrypoint',
    mgmtStopTitle: 'Stop Host',
    mgmtStopDesc: 'Send graceful SIGTERM',
    mgmtRestartTitle: 'Restart Host',
    mgmtRestartDesc: 'Graceful stop & start',
    mgmtKillTitle: 'Kill Process',
    mgmtKillDesc: 'Force immediate SIGKILL',
    mgmtReinstallTitle: 'Reinstall Image',
    mgmtReinstallDesc: 'Rebuild runtime container',
    databasesTitle: 'Host Databases',
    databasesDesc:
      'Dedicated database provisioning abstraction supporting PostgreSQL, MySQL, MongoDB, and Redis on Runtime Nodes.',
    provisionDatabaseBtn: 'Provision Database',
    noDatabases: 'No databases provisioned for this Host.',
    schedulesTitle: 'Control Plane Cron Schedules',
    schedulesDesc:
      'Automated cron tasks executed by the backend Control Plane Scheduler Worker.',
    schedNamePlaceholder: 'Daily Restart',
    schedTaskRestart: 'Restart Host',
    schedTaskStart: 'Start Host',
    schedTaskStop: 'Stop Host',
    schedTaskCommand: 'Execute Command',
    schedTaskBackup: 'Create Backup',
    schedStatusScheduled: 'Scheduled',
    addScheduleBtn: 'Add Schedule',
    noSchedules: 'No cron schedules configured for this Host.',
    backupsTitle: 'Object Storage Backups (S3 Abstraction)',
    backupsDesc:
      'Create, restore, download, or delete off-node archive snapshots stored in S3-compatible Object Storage.',
    backupNamePlaceholder: 'Pre-release snapshot',
    createBackupBtn: 'Create Backup',
    noBackups: 'No backups recorded for this Host.',
    collaboratorsTitle: 'Collaborators & Granular Permissions',
    collaboratorsDesc:
      'Assign fine-grained access scopes to collaborators by their Discord ID. The Host Owner retains full administrative privileges.',
    collaboratorDiscordIdLabel: 'Collaborator Discord ID',
    selectPermissionsLabel: 'Select Granular Permissions',
    grantPermissionsBtn: 'Grant Collaborator Permissions',
    hostSettingsTitle: 'Host Settings',
    saveSettingsBtn: 'Save Settings',
    deleteHostTitle: 'Delete Host',
    deleteHostDesc:
      'Permanently remove this Host and release its Node allocations.',
    activityLogTitle: 'Host Audit Activity Log',
    activityLogDesc:
      'Cryptographically sanitized audit trail of actions performed on this Host.',
    actorLabel: 'Actor',
    systemActor: 'System',
    noActivityEvents: 'No activity events recorded yet.',
    // Admin View
    adminTitle: 'Control Plane Administration & Runtime Nodes',
    adminDesc:
      'Manage Runtime Nodes, IP/Port Allocation pools, Users, Hosts, Databases, Backups, and System Audit Activity.',
    adminStatUsers: 'Users',
    adminStatHosts: 'Hosts',
    adminStatRegisteredNodes: 'Registered Nodes',
    adminStatConnectedNodes: 'Connected Nodes',
    adminStatAllocations: 'Allocations',
    adminStatBackups: 'Backups',
    adminNodeNameLabel: 'Node Name',
    adminLocationLabel: 'Location',
    adminFqdnLabel: 'FQDN',
    adminIpAddressLabel: 'IP Address',
    adminMaxMemoryLabel: 'Max Memory (MB)',
    adminMaxDiskLabel: 'Max Disk (MB)',
    registerNodeTitle: 'Register New Runtime Node Daemon',
    registerNodeBtn: 'Register Runtime Node',
  },
  'ar-IQ': {
    localeCode: 'ar-IQ' as SupportedLocale,
    dir: 'rtl' as 'ltr' | 'rtl',
    langName: 'العربية (العراق)',
    switchLangLabel: 'English (US)',
    brandSubtitle: 'Powered by HyperSoft',
    initializing: 'جارٍ تهيئة لوحة تحكم HyperHost...',
    // Login View
    controlPlaneApi: 'واجهة لوحة التحكم',
    online: 'متصل',
    checking: 'جارٍ الفحص',
    maxQuotaHeader: 'الحد الأقصى',
    hostsPerUser: 'استضافات / مستخدم',
    infraBadgeLeft: 'البنية السحابية من HyperSoft',
    infraBadgeRight: 'فصل كامل بين لوحة التحكم وعقد التشغيل',
    heroTitle: 'منصة احترافية لاستضافة بوتات ديسكورد وتيليجرام',
    heroDescription:
      'قم بنشر وإدارة استضافات (Hosts) معزولة لبوتات Discord وTelegram وتطبيقات Node.js وPython وJava وGo وRust مع صلاحيات دقيقة، وخزنة متغيرات بيئة مشفرة، وطرفية WebSocket فورية.',
    featureIsolatedTitle: 'طبقة تشغيل معزولة (Runtime Plane)',
    featureIsolatedDesc:
      'فصل صارم بين خادم التحكم Fastify وعقد التشغيل البعيدة (Runtime Nodes) التي تدير الحاويات وحصص المعالج والذاكرة والتخزين والشبكة.',
    featureSecurityTitle: 'أمان وحماية متقدمة (Zero-Trust)',
    featureSecurityDesc:
      'مصادقة رسمية عبر Discord OAuth2، وتشفير الأسرار بمعيار AES-256-GCM، و21 صلاحية دقيقة للمتعاونين، وسجل نشاطات مؤمّن بالكامل.',
    signInTitle: 'تسجيل الدخول إلى HyperHost',
    signInSubtitle: 'قم بالمصادقة باستخدام حساب Discord الخاص بك',
    authUnavailable: 'تعذّر تسجيل الدخول',
    connectingDiscord: 'جارٍ الاتصال بـ Discord...',
    continueWithDiscord: 'المتابعة عبر Discord OAuth2',
    loginNotificationHint:
      'سيتم إرسال رسالة خاصة (DM) إلى حسابك في Discord لتأكيد تسجيل الدخول فور إتمام المصادقة.',
    telemetryTitle: 'حالة البنية التحتية (Control Plane)',
    refresh: 'تحديث',
    fastifyServer: 'خادم Fastify API',
    postgresPrisma: 'قاعدة بيانات PostgreSQL',
    connected: 'متصل',
    awaitingDatabaseUrl: 'بانتظار DATABASE_URL',
    discordOAuthEnv: 'إعدادات Discord OAuth2',
    configured: 'مُفعّل',
    awaitingCredentials: 'بانتظار الإعدادات',
    discordLoginNotifyEnv: 'إشعار تسجيل الدخول عبر Discord DM',
    enabled: 'مُفعّل',
    optionalStandby: 'احتياطي',
    connectedRuntimeNodes: 'عقد التشغيل المتصلة (Nodes)',
    footerLeft: 'HyperHost Control Plane — Powered by HyperSoft',
    footerRight: 'Fastify · Prisma · PostgreSQL · WebSocket · Discord OAuth2',
    // Dashboard & Navigation
    navDashboard: 'لوحة التحكم والاستضافات',
    navHostPanel: 'إدارة الاستضافة (Host Panel)',
    navAdmin: 'إدارة النظام والعُقد',
    accountQuota: 'حصة الحساب',
    hostsWord: 'استضافات',
    signOut: 'تسجيل الخروج',
    controlPlaneHeader: 'لوحة تحكم HyperHost',
    runtimeNodesConnected: 'عقد التشغيل المتصلة',
    createHost: 'إنشاء استضافة',
    welcomeUser: 'مرحباً بك،',
    dashboardSubtitle:
      'أدر استضافات بوتات Discord وTelegram الخاصة بك، وراقب اتصال عقد التشغيل، واضبط إعدادات الإقلاع ومتغيرات البيئة.',
    discordLoginSuccessTitle: 'تم تسجيل الدخول إلى HyperHost بنجاح',
    discordLoginSuccessDesc:
      'جلستك الآن نشطة ومؤمّنة، وتم إرسال إشعار تسجيل الدخول عبر رسالة خاصة (DM) إلى حسابك في Discord.',
    dismiss: 'إغلاق',
    totalHosts: 'إجمالي الاستضافات',
    onlineHosts: 'الاستضافات النشطة',
    offlinePending: 'متوقفة / قيد الانتظار',
    cpuUsage: 'استهلاك المعالج',
    noMetricsAvailable: 'No metrics available · لا توجد قياسات متاحة',
    memoryQuota: 'حصة الذاكرة (RAM)',
    storageQuota: 'حصة التخزين',
    myHosts: 'استضافاتي (My Hosts)',
    usedOf: 'مستخدمة',
    noHostsTitle: 'لا توجد استضافات منشأة بعد',
    noHostsDesc:
      'أنشئ أول استضافة لبوت Discord أو بوت Telegram أو تطبيق Node.js أو Python أو Java أو Go أو Rust.',
    cpuLimit: 'حد المعالج',
    ramLimit: 'حد الذاكرة',
    nodeLabel: 'العقدة',
    runtimeNodeUnavailable: 'Runtime node unavailable · عقدة التشغيل غير متاحة',
    manage: 'إدارة الاستضافة',
    recentActivity: 'النشاطات الأخيرة',
    noRecentActivity: 'لا توجد نشاطات مسجلة في قاعدة البيانات حتى الآن.',
    // Create Host Modal
    createNewHostTitle: 'إنشاء استضافة جديدة (Create Host)',
    quotaUsage: 'استهلاك الحصة',
    noLiveNodesNotice:
      'لا توجد عقد تشغيل (Runtime Nodes) متصلة حالياً. سيتم إنشاء الاستضافة بحالة PENDING حتى يتم ربط عقدة تشغيل.',
    hostNameLabel: 'اسم الاستضافة (Host Name)',
    hostNamePlaceholder: 'مثال: Aegis Discord Bot',
    appTypeLabel: 'نوع التطبيق',
    runtimeEnvLabel: 'بيئة التشغيل (Runtime)',
    runtimeVersionLabel: 'إصدار البيئة',
    descriptionOptionalLabel: 'الوصف (اختياري)',
    descriptionPlaceholder: 'وصف مختصر لوظيفة البوت أو الخدمة',
    targetNodeLabel: 'عقدة التشغيل المستهدفة (Runtime Node)',
    unassignedNodeOption: 'غير معيّن — الاحتفاظ بحالة PENDING حتى توفر عقدة',
    cpuLimitPercentLabel: 'حد المعالج CPU (%)',
    memoryLimitMbLabel: 'حد الذاكرة RAM (MB)',
    diskLimitMbLabel: 'حد قرص التخزين NVMe (MB)',
    cancel: 'إلغاء',
    creatingHost: 'جارٍ الإنشاء...',
    // Host Panel Tabs
    tabConsole: 'الطرفية (Console)',
    tabFiles: 'الملفات (Files)',
    tabStartup: 'الإقلاع (Startup)',
    tabNetwork: 'الشبكة (Network)',
    tabMetrics: 'القياسات (Metrics)',
    tabManagement: 'التحكم (Management)',
    tabDatabases: 'قواعد البيانات',
    tabSchedules: 'المهام المجدولة',
    tabBackups: 'النسخ الاحتياطي',
    tabAdministration: 'الإدارة',
    tabUsers: 'المستخدمون',
    tabSettings: 'الإعدادات',
    tabActivity: 'سجل النشاط',
    statusLabel: 'الحالة',
    runtimeLabel: 'بيئة التشغيل',
    limitsLabel: 'الموارد المخصصة',
    startBtn: 'تشغيل',
    restartBtn: 'إعادة تشغيل',
    stopBtn: 'إيقاف',
    wsConsoleStream: 'بث الطرفية المباشر (WebSocket Console)',
    wsConnected: 'متصل',
    wsConnecting: 'جارٍ الاتصال...',
    clearConsole: 'مسح السجل',
    reconnect: 'إعادة الاتصال',
    consoleUnavailableDesc:
      'لا توجد عقدة تشغيل (Runtime Node) متصلة حالياً لبث مخرجات stdout/stderr لهذه الاستضافة. قم بتوصيل عقدة التشغيل لتفعيل التنفيذ المباشر.',
    stdinPlaceholderConnected: 'أرسل أمراً إلى حاوية التشغيل (stdin)...',
    stdinPlaceholderDisconnected: 'عقدة التشغيل غير متاحة — الإدخال معطّل',
    sendBtn: 'إرسال',
    remoteFileManager: 'مدير ملفات عقدة التشغيل',
    workingPath: 'مسار العمل',
    newFileOrFolderPlaceholder: 'اسم الملف أو المجلد الجديد',
    createFileBtn: 'إنشاء ملف',
    createFolderBtn: 'إنشاء مجلد',
    fileColName: 'الاسم',
    fileColType: 'النوع',
    fileColSize: 'الحجم',
    fileColModified: 'تاريخ التعديل',
    fileTypeDir: 'مجلد',
    fileTypeFile: 'ملف',
    filesUnavailableDesc:
      'تُحفظ ملفات الاستضافة حصرياً داخل وحدات تخزين عقد التشغيل المعزولة (Runtime Nodes) وليس على خادم الويب. قم بتوصيل عقدة التشغيل لتصفح وتحرير الملفات.',
    startupVaultTitle: 'إعدادات الإقلاع وخزنة متغيرات البيئة المشفرة',
    startupVaultDesc:
      'اضبط أمر التشغيل، وإصدار البيئة، ومسار العمل، والمتغيرات المشفرة بمعيار AES-256-GCM. لا يتم كشف القيم السرية أبداً في سجلات النشاط.',
    startupCommandLabel: 'أمر الإقلاع (Startup Command)',
    startupArgsLabel: 'المعاملات الإضافية (Arguments)',
    workingDirLabel: 'مسار العمل داخل الحاوية',
    envVarsTitle: 'متغيرات البيئة (Environment Variables)',
    secretLabel: 'سري (Secret)',
    plainLabel: 'عادي (Plain)',
    envKeyPlaceholder: 'KEY_NAME (مثال: DISCORD_TOKEN)',
    envValPlaceholder: 'القيمة السرية أو الإعداد',
    addVariableBtn: 'إضافة متغير',
    saveStartupBtn: 'حفظ إعدادات الإقلاع',
    networkTitle: 'تخصيصات الشبكة والمنافذ (Allocations)',
    networkDesc:
      'عناوين IP والمنافذ والبروتوكولات المخصصة لهذه الاستضافة على عقدة التشغيل.',
    noAllocations:
      'لا توجد منافذ شبكة مخصصة بعد. قم بتعيين الاستضافة إلى عقدة تشغيل تحتوي على منافذ متاحة.',
    netColIp: 'عنوان IP',
    netColPort: 'المنفذ',
    netColProto: 'البروتوكول',
    netColRole: 'الدور',
    netColStatus: 'الحالة',
    netRolePrimary: 'أساسي',
    netRoleSecondary: 'ثانوي',
    metricsTitle: 'قياسات موارد الحاوية (Telemetry)',
    metricsDesc:
      'قراءات حقيقية وفورية لاستهلاك المعالج والذاكرة والقرص والشبكة ووقت التشغيل من عقدة التشغيل.',
    metricsUnavailableDesc:
      'قياسات عقدة التشغيل غير متاحة حالياً. لا تقوم منصة HyperHost بعرض أي أرقام وهمية للمعالج أو الذاكرة عندما تكون عقدة التشغيل غير متصلة.',
    metricsCpuLoad: 'حمل المعالج',
    metricsMemoryUsage: 'استهلاك الذاكرة',
    metricsUptime: 'مدة التشغيل',
    managementTitle: 'إدارة دورة حياة الحاوية والعمليات',
    managementDesc:
      'إرسال أوامر التشغيل والإيقاف وإعادة البناء إلى عقدة التشغيل. في حال عدم اتصال العقدة، يعيد النظام رسالة حالة صريحة بدلاً من التظاهر بالتشغيل.',
    mgmtStartTitle: 'تشغيل الاستضافة',
    mgmtStartDesc: 'بدء تشغيل الحاوية',
    mgmtStopTitle: 'إيقاف الاستضافة',
    mgmtStopDesc: 'إرسال إشارة إيقاف آمنة SIGTERM',
    mgmtRestartTitle: 'إعادة تشغيل الاستضافة',
    mgmtRestartDesc: 'إيقاف وإعادة تشغيل متتابعة',
    mgmtKillTitle: 'إنهاء فوري (Kill)',
    mgmtKillDesc: 'إيقاف إجباري فوري SIGKILL',
    mgmtReinstallTitle: 'إعادة تثبيت الصورة',
    mgmtReinstallDesc: 'إعادة بناء حاوية التشغيل',
    databasesTitle: 'قواعد بيانات الاستضافة',
    databasesDesc:
      'طبقة إدارة وتخصيص قواعد بيانات PostgreSQL وMySQL وMongoDB وRedis على عقد التشغيل.',
    provisionDatabaseBtn: 'إنشاء قاعدة بيانات',
    noDatabases: 'لا توجد قواعد بيانات مخصصة لهذه الاستضافة.',
    schedulesTitle: 'المهام المجدولة (Cron Schedules)',
    schedulesDesc:
      'مهام مجدولة تعمل تلقائياً عبر مجدول لوحة التحكم (Control Plane Scheduler).',
    schedNamePlaceholder: 'إعادة تشغيل يومية',
    schedTaskRestart: 'إعادة تشغيل الاستضافة',
    schedTaskStart: 'تشغيل الاستضافة',
    schedTaskStop: 'إيقاف الاستضافة',
    schedTaskCommand: 'تنفيذ أمر',
    schedTaskBackup: 'إنشاء نسخة احتياطية',
    schedStatusScheduled: 'مجدولة',
    addScheduleBtn: 'إضافة مهمة مجدولة',
    noSchedules: 'لا توجد مهام مجدولة لهذه الاستضافة.',
    backupsTitle: 'النسخ الاحتياطية (S3 Object Storage)',
    backupsDesc:
      'إنشاء واستعادة وتحميل وحذف النسخ الاحتياطية المؤرشفة.',
    backupNamePlaceholder: 'نسخة احتياطية قبل التحديث',
    createBackupBtn: 'إنشاء نسخة احتياطية',
    noBackups: 'لا توجد نسخ احتياطية مسجلة لهذه الاستضافة.',
    collaboratorsTitle: 'المتعاونون والصلاحيات الدقيقة',
    collaboratorsDesc:
      'امنح صلاحيات محددة للمتعاونين عبر معرّف Discord ID الخاص بهم (21 صلاحية دقيقة).',
    collaboratorDiscordIdLabel: 'معرّف Discord ID للمتعاون',
    selectPermissionsLabel: 'اختر الصلاحيات الممنوحة',
    grantPermissionsBtn: 'حفظ صلاحيات المتعاون',
    hostSettingsTitle: 'إعدادات الاستضافة',
    saveSettingsBtn: 'حفظ الإعدادات',
    deleteHostTitle: 'حذف الاستضافة نهائياً',
    deleteHostDesc:
      'إزالة هذه الاستضافة بشكل دائم وتحرير منافذ الشبكة المخصصة لها.',
    activityLogTitle: 'سجل نشاطات وتدقيق الاستضافة',
    activityLogDesc:
      'سجل تدقيق آمن ومنقّى من البيانات الحساسة لجميع العمليات المنفذة على هذه الاستضافة.',
    actorLabel: 'المنفّذ',
    systemActor: 'النظام',
    noActivityEvents: 'لا توجد أحداث مسجلة بعد.',
    // Admin View
    adminTitle: 'إدارة لوحة التحكم وعقد التشغيل (Runtime Nodes)',
    adminDesc:
      'إدارة عقد التشغيل، ومجموعات عناوين IP والمنافذ، والمستخدمين، والاستضافات، والنسخ الاحتياطية، وسجل التدقيق العام.',
    adminStatUsers: 'المستخدمون',
    adminStatHosts: 'الاستضافات',
    adminStatRegisteredNodes: 'العقد المسجلة',
    adminStatConnectedNodes: 'العقد المتصلة',
    adminStatAllocations: 'المنافذ المخصصة',
    adminStatBackups: 'النسخ الاحتياطية',
    adminNodeNameLabel: 'اسم العقدة (Node Name)',
    adminLocationLabel: 'الموقع الجغرافي',
    adminFqdnLabel: 'النطاق (FQDN)',
    adminIpAddressLabel: 'عنوان IP',
    adminMaxMemoryLabel: 'الذاكرة القصوى (MB)',
    adminMaxDiskLabel: 'التخزين الأقصى (MB)',
    registerNodeTitle: 'تسجيل عقدة تشغيل جديدة (Runtime Node Daemon)',
    registerNodeBtn: 'تسجيل عقدة التشغيل',
  },
};

export type TranslationKeys = (typeof dictionary)['ar-IQ'];

interface I18nContextValue {
  locale: SupportedLocale;
  setLocale: (next: SupportedLocale | 'ar' | 'en') => void;
  toggleLocale: () => void;
  t: TranslationKeys;
  isRtl: boolean;
}

const I18nContext = createContext<I18nContextValue>({
  locale: 'ar-IQ',
  setLocale: () => {},
  toggleLocale: () => {},
  t: dictionary['ar-IQ'],
  isRtl: true,
});

function detectInitialLocale(): SupportedLocale {
  if (typeof window === 'undefined') return 'ar-IQ';
  try {
    const saved = window.localStorage.getItem(STORAGE_KEY);
    if (saved) {
      return normalizeLocale(saved);
    }
  } catch {
    // Ignore storage errors
  }
  return 'ar-IQ';
}

export const I18nProvider: React.FC<{ children: React.ReactNode }> = ({
  children,
}) => {
  const [locale, setLocaleState] = useState<SupportedLocale>(detectInitialLocale);

  const setLocale = (next: SupportedLocale | 'ar' | 'en') => {
    const normalized = normalizeLocale(next);
    setLocaleState(normalized);
    try {
      window.localStorage.setItem(STORAGE_KEY, normalized);
      document.cookie = `${STORAGE_KEY}=${normalized}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      // Ignore storage errors
    }
  };

  const toggleLocale = () => {
    setLocale(locale === 'ar-IQ' ? 'en-US' : 'ar-IQ');
  };

  useEffect(() => {
    const activeDict = dictionary[locale] || dictionary['ar-IQ'];
    document.documentElement.lang = locale;
    document.documentElement.dir = activeDict.dir;
    try {
      document.cookie = `${STORAGE_KEY}=${locale}; path=/; max-age=31536000; SameSite=Lax`;
    } catch {
      // Ignore cookie errors
    }
  }, [locale]);

  const value: I18nContextValue = {
    locale,
    setLocale,
    toggleLocale,
    t: dictionary[locale] || dictionary['ar-IQ'],
    isRtl: locale === 'ar-IQ',
  };

  return <I18nContext.Provider value={value}>{children}</I18nContext.Provider>;
};

export function useI18n(): I18nContextValue {
  return useContext(I18nContext);
}

export const LanguageSwitcher: React.FC<{ className?: string }> = ({
  className = '',
}) => {
  const { locale, setLocale } = useI18n();

  return (
    <div
      className={`inline-flex items-center rounded-lg bg-[#11131F] border border-slate-800 p-0.5 text-xs ${className}`}
      role="group"
      aria-label="Language Switcher"
    >
      <Globe className="w-3.5 h-3.5 text-indigo-400 mx-1.5 shrink-0" />
      <button
        type="button"
        onClick={() => setLocale('ar-IQ')}
        className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer ${
          locale === 'ar-IQ'
            ? 'bg-indigo-600 text-white'
            : 'text-slate-400 hover:text-white'
        }`}
      >
        العربية (ar-IQ)
      </button>
      <button
        type="button"
        onClick={() => setLocale('en-US')}
        className={`px-2 py-1 rounded-md font-medium transition-colors cursor-pointer ${
          locale === 'en-US'
            ? 'bg-indigo-600 text-white'
            : 'text-slate-400 hover:text-white'
        }`}
      >
        English (en-US)
      </button>
    </div>
  );
};
