import React, { createContext, useContext, useEffect, useRef, useState } from 'react';
import { Globe, ChevronDown } from 'lucide-react';
import {
  normalizeLocale,
  supportedLocales,
  type SupportedLocale,
} from '../shared/types';

export { supportedLocales, type SupportedLocale };
export type Locale = SupportedLocale;

const STORAGE_KEY = 'hyperhost_locale';

const dictionary = {
  'ar-IQ': {
    localeCode: 'ar-IQ' as SupportedLocale,
    dir: 'rtl' as 'ltr' | 'rtl',
    langName: 'العربية (ar-IQ)',
    shortLang: 'العربية',
    brandSubtitle: 'Powered by HyperSoft',
    initializing: 'جارٍ تهيئة منصة HyperHost...',
    // Public Navigation
    navHome: 'الرئيسية',
    navServices: 'الخدمات',
    navProjects: 'المشاريع',
    navAbout: 'من نحن',
    navContact: 'تواصل معنا',
    navPrivacy: 'سياسة الخصوصية',
    navTerms: 'شروط الاستخدام',
    loginWithDiscord: 'تسجيل الدخول عبر Discord',
    connectingDiscord: 'جارٍ التحويل إلى Discord...',
    openDashboard: 'لوحة التحكم',
    languageLabel: 'اللغة',
    openMenuAria: 'فتح القائمة الرئيسية',
    closeMenuAria: 'إغلاق القائمة الرئيسية',
    // Homepage
    heroBadge: 'HyperHost — Powered by HyperSoft',
    heroTitle: 'منصة احترافية لاستضافة بوتات Discord وTelegram',
    heroDescription:
      'بيئة سحابية متخصصة لإدارة واستضافة بوتات Discord وTelegram وتطبيقات Node.js وPython وJava وGo وRust مع عزل كامل بين طبقة التحكم وطبقة التشغيل، وتشفير متغيرات البيئة بمعيار AES-256-GCM، وصلاحيات دقيقة للفرق.',
    exploreServicesBtn: 'استعراض الخدمات',
    viewArchitectureBtn: 'معمارية المنصة',
    supportedWorkloadsTitle: 'بيئات التشغيل واللغات المدعومة',
    supportedWorkloadsDesc:
      'تدعم HyperHost تشغيل البوتات والخدمات الخلفية عبر حاويات معزولة تُدار بواسطة Runtime Plane مع تخصيص دقيق للمعالج والذاكرة والتخزين.',
    runtimeAvailabilityNote:
      'ملاحظة تقنية: يتم تنفيذ الحاويات الفعلي عند ربط عقدة تشغيل (Runtime Node) نشطة. لا تعرض المنصة أي حالة اتصال أو قياسات وهمية عند عدم وجود عقدة تشغيل متصلة.',
    discordBotHostingTitle: 'استضافة بوتات Discord',
    discordBotHostingDesc:
      'دعم كامل لبوتات Discord المبنية على Discord.js وEris وPycord وJDA وSerenity مع إدارة آمنة للتوكنات وإعادة تشغيل مجدولة.',
    telegramBotHostingTitle: 'استضافة بوتات Telegram',
    telegramBotHostingDesc:
      'تشغيل مستقر لبوتات Telegram باستخدام Telegraf وGrammy وAiogram وTelebot مع طرفية WebSocket مباشرة وسجلات تدقيق.',
    architecturePillarsTitle: 'ركائز الأمان والهندسة في HyperHost',
    pillarControlRuntimeTitle: 'فصل طبقة التحكم عن طبقة التشغيل',
    pillarControlRuntimeDesc:
      'خادم التحكم (Fastify + PostgreSQL) يدير المصادقة والصلاحيات والجدولة دون تنفيذ أي كود مستخدم على نفس الخادم.',
    pillarEncryptionTitle: 'تشفير الأسرار بمعيار AES-256-GCM',
    pillarEncryptionDesc:
      'تُشفّر متغيرات البيئة وتوكنات البوتات قبل حفظها في قاعدة البيانات ولا تُكشف أبداً في سجلات النشاط أو واجهات البرمجة.',
    pillarRbacTitle: '21 صلاحية دقيقة للمتعاونين',
    pillarRbacDesc:
      'امنح أعضاء فريقك صلاحيات محددة على مستوى كل استضافة (الطرفية، الملفات، الإقلاع، الشبكة، النسخ الاحتياطي) عبر معرّف Discord.',
    pillarIdentityTitle: 'معرّفات عامة غير تسلسلية',
    pillarIdentityDesc:
      'يمتلك كل مستخدم واستضافة معرّفاً عاماً آمناً وغير تسلسلي (usr_ / srv_) لحماية الهوية الداخلية في قاعدة البيانات.',
    // Dashboard & Navigation
    navDashboard: 'لوحة التحكم',
    navHostPanel: 'إدارة الاستضافة',
    navAdmin: 'إدارة النظام (Control Plane)',
    accountQuota: 'حصة الحساب',
    hostsWord: 'استضافات',
    maxQuotaLabel: 'الحد الأقصى: 10 Hosts',
    signOut: 'تسجيل الخروج',
    controlPlaneHeader: 'لوحة تحكم HyperHost',
    createHost: 'إنشاء استضافة جديدة',
    welcomeUser: 'مرحباً،',
    publicUserIdLabel: 'معرّف المستخدم العام (Public User ID)',
    discordIdLabel: 'معرّف Discord',
    currentHostsCountLabel: 'عدد الاستضافات الحالية',
    dashboardSubtitle:
      'أدر استضافاتك، وتابع حالة بيئة التشغيل، واضبط إعدادات الإقلاع ومتغيرات البيئة المشفرة.',
    discordLoginSuccessTitle: 'تم تسجيل الدخول بنجاح إلى HyperHost',
    discordLoginSuccessDesc:
      'جلستك الآن نشطة ومؤمّنة، وتم إرسال إشعار تسجيل الدخول عبر رسالة خاصة (DM) في Discord.',
    dismiss: 'إغلاق',
    totalHosts: 'الاستضافات الحالية',
    onlineHosts: 'الاستضافات المتصلة',
    offlinePending: 'غير متصلة / قيد الانتظار',
    cpuUsage: 'استهلاك المعالج',
    noMetricsAvailable: 'لا توجد قياسات متاحة',
    memoryQuota: 'مجموع الذاكرة المخصصة',
    storageQuota: 'مجموع التخزين المخصص',
    myHosts: 'استضافاتي',
    usedOf: 'مستخدمة',
    noHostsTitle: 'لا توجد استضافات منشأة حالياً',
    noHostsDesc:
      'أنشئ أول استضافة لبوت Discord أو بوت Telegram أو تطبيق Node.js أو Python أو Java أو Go أو Rust.',
    serverIdLabel: 'Server ID',
    createdAtLabel: 'تاريخ الإنشاء',
    cpuLimit: 'حد المعالج',
    ramLimit: 'حد الذاكرة',
    nodeLabel: 'العقدة',
    runtimeUnavailable: 'Runtime unavailable · بيئة التشغيل غير متاحة',
    runtimeNodeUnavailable: 'Runtime unavailable',
    openBtn: 'فتح (Open)',
    manage: 'إدارة (Manage)',
    settingsActionBtn: 'الإعدادات (Settings)',
    recentActivity: 'سجل النشاطات الأخير',
    noRecentActivity: 'لا توجد نشاطات مسجلة في قاعدة البيانات حتى الآن.',
    copied: 'تم النسخ',
    copyId: 'نسخ المعرّف',
    // Create Host Modal
    createNewHostTitle: 'إنشاء استضافة جديدة (Create Host)',
    quotaUsage: 'استهلاك الحصة',
    noLiveNodesNotice:
      'لا توجد عقدة تشغيل متصلة حالياً. سيتم حفظ الاستضافة في قاعدة البيانات بحالة PENDING (Runtime unavailable) حتى يتم ربط عقدة تشغيل.',
    hostNameLabel: 'اسم الاستضافة (Host Name)',
    hostNamePlaceholder: 'مثال: Aegis Discord Bot',
    appTypeLabel: 'نوع التطبيق',
    runtimeEnvLabel: 'بيئة التشغيل (Runtime)',
    runtimeVersionLabel: 'إصدار البيئة',
    descriptionOptionalLabel: 'الوصف (اختياري)',
    descriptionPlaceholder: 'وصف مختصر لوظيفة البوت أو الخدمة',
    targetNodeLabel: 'عقدة التشغيل المستهدفة',
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
    tabDatabases: 'قواعد البيانات (Databases)',
    tabSchedules: 'الجدولة (Schedules)',
    tabBackups: 'النسخ الاحتياطي (Backups)',
    tabAdministration: 'الإدارة (Administration)',
    tabUsers: 'المستخدمون (Users)',
    tabSettings: 'الإعدادات (Settings)',
    tabActivity: 'النشاطات (Activity)',
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
      'لا توجد عقدة تشغيل متاحة حاليًا. ستبدأ الاستضافة بعد توفر عقدة تشغيل.',
    stdinPlaceholderConnected: 'أرسل أمراً إلى حاوية التشغيل (stdin)...',
    stdinPlaceholderDisconnected: 'بيئة التشغيل غير متاحة — الإدخال معطّل',
    sendBtn: 'إرسال',
    remoteFileManager: 'مدير ملفات الاستضافة',
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
      'تُحفظ ملفات الاستضافة حصرياً داخل وحدات تخزين عقد التشغيل المعزولة وليس على خادم الويب.',
    startupVaultTitle: 'إعدادات الإقلاع وخزنة متغيرات البيئة المشفرة',
    startupVaultDesc:
      'اضبط أمر التشغيل، وإصدار البيئة، ومسار العمل، والمتغيرات المشفرة بمعيار AES-256-GCM. لا يتم كشف القيم السرية أبداً في سجلات النشاط.',
    startupCommandLabel: 'أمر الإقلاع (Startup Command)',
    startupArgsLabel: 'المعاملات الإضافية (Arguments)',
    workingDirLabel: 'مسار العمل داخل الحاوية',
    envVarsTitle: 'متغيرات البيئة (Environment Variables)',
    secretLabel: 'سري (AES-256-GCM)',
    plainLabel: 'نص عادي',
    envKeyPlaceholder: 'KEY_NAME (مثال: DISCORD_TOKEN)',
    envValPlaceholder: 'القيمة السرية أو الإعداد',
    addVariableBtn: 'إضافة متغير',
    saveStartupBtn: 'حفظ إعدادات الإقلاع',
    networkTitle: 'تخصيصات الشبكة والمنافذ (Allocations)',
    networkDesc:
      'عناوين IP والمنافذ والبروتوكولات المخصصة لهذه الاستضافة.',
    noAllocations:
      'لا توجد منافذ شبكة مخصصة بعد.',
    netColIp: 'عنوان IP',
    netColPort: 'المنفذ',
    netColProto: 'البروتوكول',
    netColRole: 'الدور',
    netColStatus: 'الحالة',
    netRolePrimary: 'أساسي',
    netRoleSecondary: 'ثانوي',
    metricsTitle: 'قياسات موارد الحاوية (Telemetry)',
    metricsDesc:
      'قراءات حقيقية وفورية لاستهلاك المعالج والذاكرة والقرص والشبكة من عقدة التشغيل.',
    metricsUnavailableDesc:
      'بيئة التشغيل غير متاحة حالياً (Runtime unavailable). لا تقوم منصة HyperHost بعرض أي أرقام وهمية للمعالج أو الذاكرة.',
    metricsCpuLoad: 'حمل المعالج',
    metricsMemoryUsage: 'استهلاك الذاكرة',
    metricsUptime: 'مدة التشغيل',
    managementTitle: 'إدارة دورة حياة الحاوية والعمليات',
    managementDesc:
      'إرسال أوامر التشغيل والإيقاف وإعادة البناء إلى عقدة التشغيل.',
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
      'طبقة إدارة وتخصيص قواعد بيانات PostgreSQL وMySQL وMongoDB وRedis.',
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
    adminTitle: 'إدارة النظام (Control Plane Administration)',
    adminDesc:
      'إدارة ومراقبة البيانات الحقيقية في PostgreSQL: المستخدمون، الاستضافات، النشاطات، الجلسات، العُقد، قواعد البيانات، الجدولة، والنسخ الاحتياطي.',
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
    userIdLabel: 'معرّف المستخدم',
    online: 'متصل',
    checking: 'جارٍ التحقق...',
    refresh: 'تحديث',
    fileColActions: 'الإجراءات',
    deleteBtn: 'حذف',
    adminTabUsers: 'المستخدمون',
    adminTabHosts: 'الاستضافات',
    adminTabActivity: 'النشاطات',
    adminTabSessions: 'الجلسات',
    adminTabNodes: 'العُقد',
    adminTabDatabases: 'قواعد البيانات',
    adminTabSchedules: 'الجدولة',
    adminTabBackups: 'النسخ الاحتياطية',
    adminSearchPlaceholder: 'ابحث بالاسم أو المعرّف (usr_ / srv_) أو Discord ID...',
    adminFilterAll: 'الكل',
    adminSortNewest: 'الأحدث أولاً',
    adminSortOldest: 'الأقدم أولاً',
    adminSortName: 'الاسم',
    adminNoRecords: 'لا توجد سجلات مطابقة في قاعدة البيانات.',
    adminRoleLabel: 'الدور',
    adminResumeHostBtn: 'تفعيل',
    adminSuspendHostBtn: 'تعليق',
    adminRevokeSessionBtn: 'إبطال الجلسة',
    adminInspectBtn: 'التفاصيل',
    adminPageLabel: 'الصفحة',
    adminPrevPage: 'السابق',
    adminNextPage: 'التالي',
    adminRecordDetailsTitle: 'تفاصيل السجل من PostgreSQL',
    // Required Phase 1 Localization Keys (Runtime Node, Host, Discord, Console)
    'runtime.node.unavailable':
      'لا توجد عقدة تشغيل متاحة حاليًا. ستبدأ الاستضافة بعد توفر عقدة تشغيل.',
    'runtime.node.connecting': 'جارٍ الاتصال بعقدة التشغيل...',
    'runtime.node.online': 'عقدة التشغيل متصلة (ONLINE)',
    'runtime.node.offline': 'عقدة التشغيل غير متصلة (OFFLINE)',
    'runtime.node.degraded': 'أداء عقدة التشغيل منخفض (DEGRADED)',
    'runtime.host.pending': 'بانتظار عقدة تشغيل (PENDING)',
    'runtime.host.starting': 'جارٍ تشغيل الاستضافة (STARTING)',
    'runtime.host.running': 'قيد التشغيل (RUNNING)',
    'runtime.host.stopped': 'متوقفة (STOPPED)',
    'runtime.host.error': 'خطأ في التشغيل (ERROR)',
    'discord.login.title': '🔐 تم تسجيل الدخول بنجاح إلى HyperHost',
    'discord.login.success':
      'تم تسجيل الدخول بنجاح وإرسال إشعار أمني إلى رسائل Discord الخاصة بك.',
    'discord.host.created.title': '🚀 تم إنشاء استضافتك في HyperHost',
    'discord.host.created.success':
      'تم إنشاء الاستضافة بنجاح وإرسال تفاصيلها إلى رسائل Discord الخاصة بك.',
    'discord.notification.failed':
      'تعذّر إرسال إشعار Discord عبر الرسائل الخاصة (تحقق من إعدادات الخصوصية أو توكن البوت).',
    'console.connecting': 'جارٍ الاتصال بالطرفية...',
    'console.connected': 'متصل بعقدة التشغيل',
    'console.disconnected': 'غير متصل بالطرفية',
    'console.runtimeUnavailable': 'عقدة التشغيل غير متاحة حالياً (RUNTIME_NODE_UNAVAILABLE)',
    'console.waitingForNode':
      'لا توجد عقدة تشغيل متاحة حاليًا. ستبدأ الاستضافة بعد توفر عقدة تشغيل.',
  },
  'en-US': {
    localeCode: 'en-US' as SupportedLocale,
    dir: 'ltr' as 'ltr' | 'rtl',
    langName: 'English (en-US)',
    shortLang: 'English',
    brandSubtitle: 'Powered by HyperSoft',
    initializing: 'Initializing HyperHost Platform...',
    // Public Navigation
    navHome: 'Home',
    navServices: 'Services',
    navProjects: 'Projects',
    navAbout: 'About',
    navContact: 'Contact',
    navPrivacy: 'Privacy Policy',
    navTerms: 'Terms of Service',
    loginWithDiscord: 'Login with Discord',
    connectingDiscord: 'Redirecting to Discord...',
    openDashboard: 'Dashboard',
    languageLabel: 'Language',
    openMenuAria: 'Open main navigation menu',
    closeMenuAria: 'Close main navigation menu',
    // Homepage
    heroBadge: 'HyperHost — Powered by HyperSoft',
    heroTitle: 'Professional Discord & Telegram Bot Hosting Platform',
    heroDescription:
      'Purpose-built cloud control plane for deploying and managing Discord bots, Telegram bots, and Node.js, Python, Java, Go, and Rust workloads with strict Control Plane / Runtime Plane isolation, AES-256-GCM secret encryption, and granular team permissions.',
    exploreServicesBtn: 'Explore Services',
    viewArchitectureBtn: 'Platform Architecture',
    supportedWorkloadsTitle: 'Supported Bot & Application Runtimes',
    supportedWorkloadsDesc:
      'HyperHost provisions isolated container environments managed by the Runtime Plane with dedicated CPU, memory, and NVMe storage limits.',
    runtimeAvailabilityNote:
      'Technical Note: Container execution requires an attached Runtime Node. HyperHost never displays fabricated node counts, fake uptime percentages, or simulated telemetry.',
    discordBotHostingTitle: 'Discord Bot Hosting',
    discordBotHostingDesc:
      'First-class support for Discord.js, Eris, Pycord, JDA, and Serenity bots with encrypted token vaults and automated cron restarts.',
    telegramBotHostingTitle: 'Telegram Bot Hosting',
    telegramBotHostingDesc:
      'Reliable hosting for Telegraf, Grammy, Aiogram, and Telebot workloads with live WebSocket console streams and sanitized audit logs.',
    architecturePillarsTitle: 'HyperHost Security & Engineering Pillars',
    pillarControlRuntimeTitle: 'Control Plane & Runtime Plane Separation',
    pillarControlRuntimeDesc:
      'The Fastify + PostgreSQL Control Plane manages authentication, RBAC, and scheduling without executing untrusted user code on the web server.',
    pillarEncryptionTitle: 'AES-256-GCM Secret Encryption at Rest',
    pillarEncryptionDesc:
      'Environment variables and OAuth tokens are encrypted using AES-256-GCM prior to database storage and are never exposed in logs or responses.',
    pillarRbacTitle: '21 Granular Collaborator Scopes',
    pillarRbacDesc:
      'Grant fine-grained per-Host permissions (Console, Files, Startup, Network, Backups) to team members via their Discord ID.',
    pillarIdentityTitle: 'Non-Sequential Public Identifiers',
    pillarIdentityDesc:
      'Every User and Host is assigned an immutable, non-sequential public identifier (usr_ / srv_) so internal primary keys remain protected.',
    // Dashboard & Navigation
    navDashboard: 'Dashboard',
    navHostPanel: 'Host Panel',
    navAdmin: 'Control Plane Admin',
    accountQuota: 'Account Quota',
    hostsWord: 'Hosts',
    maxQuotaLabel: 'Max Quota: 10 Hosts',
    signOut: 'Sign Out',
    controlPlaneHeader: 'HyperHost Control Plane',
    createHost: 'Create Host',
    welcomeUser: 'Welcome,',
    publicUserIdLabel: 'Public User ID',
    discordIdLabel: 'Discord ID',
    currentHostsCountLabel: 'Current Hosts',
    dashboardSubtitle:
      'Manage your Discord & Telegram Bot Hosts, inspect runtime status, and configure encrypted startup environments.',
    discordLoginSuccessTitle: 'Signed in to HyperHost via Discord',
    discordLoginSuccessDesc:
      'Your session is active and a Discord login DM notification has been dispatched to your account.',
    dismiss: 'Dismiss',
    totalHosts: 'Current Hosts',
    onlineHosts: 'Online Hosts',
    offlinePending: 'Offline / Pending',
    cpuUsage: 'CPU Usage',
    noMetricsAvailable: 'No metrics available',
    memoryQuota: 'Allocated Memory',
    storageQuota: 'Allocated Storage',
    myHosts: 'My Hosts',
    usedOf: 'used',
    noHostsTitle: 'No Hosts Provisioned Yet',
    noHostsDesc:
      'Create your first Discord Bot, Telegram Bot, Node.js, Python, Java, Go, or Rust Host.',
    serverIdLabel: 'Server ID',
    createdAtLabel: 'Created At',
    cpuLimit: 'CPU Limit',
    ramLimit: 'RAM Limit',
    nodeLabel: 'Node',
    runtimeUnavailable: 'Runtime unavailable',
    runtimeNodeUnavailable: 'Runtime unavailable',
    openBtn: 'Open',
    manage: 'Manage',
    settingsActionBtn: 'Settings',
    recentActivity: 'Recent Activity',
    noRecentActivity: 'No recent activity recorded in PostgreSQL.',
    copied: 'Copied',
    copyId: 'Copy ID',
    // Create Host Modal
    createNewHostTitle: 'Create New Host',
    quotaUsage: 'Quota usage',
    noLiveNodesNotice:
      'No live Runtime Nodes are currently connected. Your Host will be saved in PostgreSQL with PENDING (Runtime unavailable) status until a Runtime Node is attached.',
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
      'No runtime node is currently available. The host will start when a runtime node becomes available.',
    stdinPlaceholderConnected: 'Send command to container stdin...',
    stdinPlaceholderDisconnected: 'Runtime unavailable — stdin disabled',
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
      'Host files reside exclusively on isolated Runtime Node volumes and never on the Control Plane web filesystem.',
    startupVaultTitle: 'Startup Configuration & Encrypted Environment Vault',
    startupVaultDesc:
      'Configure container entrypoint, runtime version, working directory, and AES-256-GCM encrypted variables. Secrets are never exposed in Activity Logs.',
    startupCommandLabel: 'Startup Command',
    startupArgsLabel: 'Arguments (Space-separated)',
    workingDirLabel: 'Container Working Directory',
    envVarsTitle: 'Environment Variables',
    secretLabel: 'Secret (AES-256-GCM)',
    plainLabel: 'Plain',
    envKeyPlaceholder: 'KEY_NAME (e.g. DISCORD_TOKEN)',
    envValPlaceholder: 'Secret or configuration value',
    addVariableBtn: 'Add Variable',
    saveStartupBtn: 'Save Startup Configuration',
    networkTitle: 'Network & Node Allocations',
    networkDesc:
      'IP, Port, and Protocol bindings assigned to this Host on its Runtime Node.',
    noAllocations:
      'No network allocations assigned.',
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
      'Runtime unavailable. HyperHost never displays fabricated CPU, RAM, or network metrics when no Runtime Node is connected.',
    metricsCpuLoad: 'CPU Load',
    metricsMemoryUsage: 'Memory Usage',
    metricsUptime: 'Uptime',
    managementTitle: 'Process & Container Lifecycle Management',
    managementDesc:
      'Dispatch lifecycle commands to the Runtime Node ProcessManager and ContainerManager.',
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
      'Dedicated database provisioning abstraction supporting PostgreSQL, MySQL, MongoDB, and Redis.',
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
    adminTitle: 'Control Plane Administration',
    adminDesc:
      'Inspect and manage real PostgreSQL records across Users, Hosts, Activity, Sessions, Nodes, Databases, Schedules, and Backups.',
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
    userIdLabel: 'User ID',
    online: 'Online',
    checking: 'Checking...',
    refresh: 'Refresh',
    fileColActions: 'Actions',
    deleteBtn: 'Delete',
    adminTabUsers: 'Users',
    adminTabHosts: 'Hosts',
    adminTabActivity: 'Activity',
    adminTabSessions: 'Sessions',
    adminTabNodes: 'Nodes',
    adminTabDatabases: 'Databases',
    adminTabSchedules: 'Schedules',
    adminTabBackups: 'Backups',
    adminSearchPlaceholder: 'Search by name, public ID (usr_ / srv_), or Discord ID...',
    adminFilterAll: 'All Statuses',
    adminSortNewest: 'Newest First',
    adminSortOldest: 'Oldest First',
    adminSortName: 'Name (A-Z)',
    adminNoRecords: 'No matching records found in PostgreSQL.',
    adminRoleLabel: 'Role',
    adminResumeHostBtn: 'Resume',
    adminSuspendHostBtn: 'Suspend',
    adminRevokeSessionBtn: 'Revoke Session',
    adminInspectBtn: 'Inspect',
    adminPageLabel: 'Page',
    adminPrevPage: 'Previous',
    adminNextPage: 'Next',
    adminRecordDetailsTitle: 'PostgreSQL Record Details',
    // Required Phase 1 Localization Keys (Runtime Node, Host, Discord, Console)
    'runtime.node.unavailable':
      'No runtime node is currently available. The host will start when a runtime node becomes available.',
    'runtime.node.connecting': 'Connecting to Runtime Node...',
    'runtime.node.online': 'Runtime Node Online (ONLINE)',
    'runtime.node.offline': 'Runtime Node Offline (OFFLINE)',
    'runtime.node.degraded': 'Runtime Node Degraded (DEGRADED)',
    'runtime.host.pending': 'Pending Runtime Node (PENDING)',
    'runtime.host.starting': 'Starting Host (STARTING)',
    'runtime.host.running': 'Running (RUNNING)',
    'runtime.host.stopped': 'Stopped (STOPPED)',
    'runtime.host.error': 'Runtime Error (ERROR)',
    'discord.login.title': '🔐 HyperHost Login Successful',
    'discord.login.success':
      'Signed in successfully and delivered a security notification to your Discord DMs.',
    'discord.host.created.title': '🚀 HyperHost Host Created',
    'discord.host.created.success':
      'Host created successfully and details sent to your Discord DMs.',
    'discord.notification.failed':
      'Could not deliver Discord DM notification (verify DM privacy settings or bot token).',
    'console.connecting': 'Connecting to console...',
    'console.connected': 'Connected to Runtime Node',
    'console.disconnected': 'Console disconnected',
    'console.runtimeUnavailable': 'Runtime Node Unavailable (RUNTIME_NODE_UNAVAILABLE)',
    'console.waitingForNode':
      'No runtime node is currently available. The host will start when a runtime node becomes available.',
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

export const LanguageSwitcher: React.FC<{
  className?: string;
  compact?: boolean;
}> = ({ className = '', compact = false }) => {
  const { locale, setLocale, t } = useI18n();
  const [open, setOpen] = useState(false);
  const containerRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    const handleClickOutside = (e: MouseEvent) => {
      if (
        containerRef.current &&
        !containerRef.current.contains(e.target as Node)
      ) {
        setOpen(false);
      }
    };
    document.addEventListener('mousedown', handleClickOutside);
    return () => document.removeEventListener('mousedown', handleClickOutside);
  }, []);

  return (
    <div ref={containerRef} className={`relative inline-block ${className}`}>
      <button
        type="button"
        onClick={() => setOpen((prev) => !prev)}
        aria-haspopup="listbox"
        aria-expanded={open}
        aria-label={t.languageLabel}
        className="min-h-[40px] px-3 py-2 rounded-xl bg-[#121424] hover:bg-[#191C32] border border-violet-500/20 text-xs font-medium text-slate-200 inline-flex items-center gap-2 transition-colors whitespace-nowrap cursor-pointer focus-visible:outline-2 focus-visible:outline-violet-500"
      >
        <Globe className="w-4 h-4 text-violet-400 shrink-0" />
        <span>{compact ? (locale === 'ar-IQ' ? 'AR' : 'EN') : t.shortLang}</span>
        <ChevronDown className="w-3.5 h-3.5 text-slate-400 shrink-0" />
      </button>

      {open && (
        <div
          role="listbox"
          aria-label={t.languageLabel}
          className="absolute end-0 mt-2 w-48 rounded-xl bg-[#101220] border border-slate-800 shadow-2xl p-1.5 z-50 space-y-1"
        >
          <button
            type="button"
            role="option"
            aria-selected={locale === 'ar-IQ'}
            onClick={() => {
              setLocale('ar-IQ');
              setOpen(false);
            }}
            className={`w-full px-3 py-2.5 rounded-lg text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              locale === 'ar-IQ'
                ? 'bg-violet-600 text-white'
                : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
            }`}
          >
            <span>العربية (ar-IQ)</span>
            <span className="text-[10px] opacity-80">RTL</span>
          </button>

          <button
            type="button"
            role="option"
            aria-selected={locale === 'en-US'}
            onClick={() => {
              setLocale('en-US');
              setOpen(false);
            }}
            className={`w-full px-3 py-2.5 rounded-lg text-xs font-medium flex items-center justify-between transition-colors cursor-pointer ${
              locale === 'en-US'
                ? 'bg-violet-600 text-white'
                : 'text-slate-300 hover:bg-slate-800/70 hover:text-white'
            }`}
          >
            <span>English (en-US)</span>
            <span className="text-[10px] opacity-80">LTR</span>
          </button>
        </div>
      )}
    </div>
  );
};
