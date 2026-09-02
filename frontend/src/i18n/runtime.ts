export type UiLang =
  'tr' |
  'en' |
  'ru';


export const LANGUAGE_KEY =
  'radar_lang';


const LOCALE:
  Record<UiLang, string> = {

  tr:
    'tr-TR',

  en:
    'en-US',

  ru:
    'ru-RU',
};


type Translation =
  readonly [
    tr: string,
    en: string,
    ru: string,
  ];


/*
 * Canonical V2 UI catalogue.
 *
 * Technical product/network names intentionally remain
 * untranslated:
 * ACKI NACKI, NACKL, Cloud Miner, Local Miner,
 * Boost Farm, Telegram, MAINNET, TPS.
 */
const CATALOG:
  Translation[] = [

  /*
   * Navigation / common.
   */

  [
    'Ana Sayfa',
    'Home',
    'Главная',
  ],

  [
    'Planlar',
    'Plans',
    'Планы',
  ],

  [
    'Referanslar',
    'Referrals',
    'Рефералы',
  ],

  [
    'Destek',
    'Support',
    'Поддержка',
  ],

  [
    'Ara',
    'Search',
    'Поиск',
  ],

  [
    'Cüzdan',
    'Wallet',
    'Кошелёк',
  ],

  [
    'Cüzdan adı',
    'Wallet name',
    'Имя кошелька',
  ],

  [
    'Cüzdan adı veya adres — örn. ackerman',
    'Wallet name or address — e.g. ackerman',
    'Имя или адрес кошелька — напр. ackerman',
  ],

  [
    'Cüzdan adı veya adres girin.',
    'Enter a wallet name or address.',
    'Введите имя или адрес кошелька.',
  ],

  [
    'Oturum',
    'Session',
    'Сессия',
  ],

  [
    'Çıkış',
    'Logout',
    'Выйти',
  ],

  [
    'DURUM',
    'STATUS',
    'СТАТУС',
  ],

  [
    'AKTİF',
    'ACTIVE',
    'АКТИВЕН',
  ],

  [
    'DURDURULDU',
    'STOPPED',
    'ОСТАНОВЛЕН',
  ],

  [
    'HATA',
    'ERROR',
    'ОШИБКА',
  ],

  [
    'BİLİNMİYOR',
    'UNKNOWN',
    'НЕИЗВЕСТНО',
  ],

  [
    'ONAY BEKLİYOR',
    'WAITING FOR APPROVAL',
    'ОЖИДАНИЕ ПОДТВЕРЖДЕНИЯ',
  ],

  [
    'BAŞLAT',
    'START',
    'ЗАПУСТИТЬ',
  ],

  [
    'DURDUR',
    'STOP',
    'ОСТАНОВИТЬ',
  ],

  [
    'KALDIR',
    'REMOVE',
    'УДАЛИТЬ',
  ],

  [
    'KOPYALA',
    'COPY',
    'КОПИРОВАТЬ',
  ],

  [
    'KOPYALANDI',
    'COPIED',
    'СКОПИРОВАНО',
  ],

  [
    'Yakında',
    'Soon',
    'Скоро',
  ],


  /*
   * Home / Radar.
   */
  [
    'Ağın canlı nabzı.',
    'Live pulse of the network.',
    'Живой пульс сети.',
  ],

  [
    'BAĞLANIYOR',
    'CONNECTING',
    'ПОДКЛЮЧЕНИЕ',
  ],

  [
    'CHAIN BEKLENİYOR',
    'WAITING FOR CHAIN',
    'ОЖИДАНИЕ СЕТИ',
  ],

  [
    'CANLI VERİ',
    'LIVE DATA',
    'АКТУАЛЬНЫЕ ДАННЫЕ',
  ],

  [
    'VERİ GECİKMELİ',
    'DELAYED DATA',
    'ДАННЫЕ ЗАДЕРЖИВАЮТСЯ',
  ],

  [
    'VERİ BEKLENİYOR',
    'WAITING FOR DATA',
    'ОЖИДАНИЕ ДАННЫХ',
  ],

  [
    'VERİ BAĞLANTISI YOK',
    'NO DATA CONNECTION',
    'НЕТ СОЕДИНЕНИЯ С ДАННЫМИ',
  ],

  [
    'İŞLEM / SANİYE',
    'TX / SECOND',
    'ТРАНЗАКЦИЙ / СЕК',
  ],

  [
    'BLOK',
    'BLOCK',
    'БЛОК',
  ],

  [
    'Blok',
    'Block',
    'Блок',
  ],

  [
    'SON BLOK',
    'LATEST BLOCK',
    'ПОСЛЕДНИЙ БЛОК',
  ],

  [
    'BLOK SÜRESİ',
    'BLOCK TIME',
    'ВРЕМЯ БЛОКА',
  ],

  [
    'Blok süresi',
    'Block time',
    'Время блока',
  ],

  [
    'AĞ HIZI',
    'NETWORK SPEED',
    'СКОРОСТЬ СЕТИ',
  ],

  [
    'RADAR · 7/24 TARAMA',
    'RADAR · 24/7 SCAN',
    'РАДАР · 24/7 СКАНИРОВАНИЕ',
  ],

  [
    'İZLENEN CÜZDAN',
    'TRACKED WALLETS',
    'ОТСЛЕЖИВАЕМЫЕ КОШЕЛЬКИ',
  ],

  [
    'İzlenen cüzdan',
    'Tracked wallets',
    'Отслеживаемые кошельки',
  ],

  [
    'CANLI TAKİP',
    'LIVE TRACKING',
    'ОНЛАЙН МОНИТОРИНГ',
  ],

  [
    'NACKL · TOPLAM',
    'NACKL · TOTAL',
    'NACKL · ВСЕГО',
  ],

  [
    'NACKL · toplam',
    'NACKL · total',
    'NACKL · всего',
  ],

  [
    'TOPLAM AKIŞ',
    'TOTAL FLOW',
    'ОБЩИЙ ПОТОК',
  ],

  [
    'TPS · SON 24 SAAT',
    'TPS · LAST 24 HOURS',
    'TPS · ПОСЛЕДНИЕ 24 ЧАСА',
  ],

  [
    'YENİ BLOK',
    'NEW BLOCK',
    'НОВЫЙ БЛОК',
  ],

  [
    'CANLI AKTİVİTE',
    'LIVE ACTIVITY',
    'АКТИВНОСТЬ',
  ],

  [
    'RADAR TARAMASI',
    'RADAR SCAN',
    'СКАНИРОВАНИЕ РАДАРА',
  ],

  [
    '7 / 24 AKTİF',
    '24 / 7 ACTIVE',
    '24 / 7 АКТИВНО',
  ],

  [
    'NOMİNAL',
    'NOMINAL',
    'НОМИНАЛ',
  ],

  [
    'Panel Girişi',
    'Dashboard Access',
    'Вход в панель',
  ],

  [
    'Telegram doğrulamasıyla madencilik panelinize güvenle devam edin.',
    'Continue securely to your mining dashboard with Telegram verification.',
    'Безопасно войдите в панель майнинга через Telegram.',
  ],

  [
    'Telegram ile panele devam et',
    'Continue to dashboard with Telegram',
    'Перейти в панель через Telegram',
  ],


  /*
   * Authentication / Cloud Miner.
   */
  [
    'TELEGRAM İLE DEVAM ET',
    'CONTINUE WITH TELEGRAM',
    'ПРОДОЛЖИТЬ ЧЕРЕЗ TELEGRAM',
  ],

  [
    'TELEGRAM İLE GİRİŞ',
    'SIGN IN WITH TELEGRAM',
    'ВОЙТИ ЧЕРЕЗ TELEGRAM',
  ],

  [
    'OTURUM KONTROL EDİLİYOR',
    'CHECKING SESSION',
    'ПРОВЕРКА СЕССИИ',
  ],

  [
    'OTURUM DOĞRULANIYOR',
    'VERIFYING SESSION',
    'ПРОВЕРКА СЕССИИ',
  ],

  [
    'GÜVENLİ OTURUM',
    'SECURE SESSION',
    'ЗАЩИЩЁННАЯ СЕССИЯ',
  ],

  [
    'Bağlı Cüzdanlar',
    'Connected Wallets',
    'Подключённые кошельки',
  ],

  [
    'YENİ CÜZDAN',
    'NEW WALLET',
    'НОВЫЙ КОШЕЛЁК',
  ],

  [
    'Abonelik',
    'Subscription',
    'Подписка',
  ],

  [
    'Henüz bağlı bir cüzdan yok.',
    'No wallet is connected yet.',
    'Подключённых кошельков пока нет.',
  ],

  [
    'İsimsiz cüzdan',
    'Unnamed wallet',
    'Кошелёк без имени',
  ],

  [
    'Telegram oturumu',
    'Telegram session',
    'Сессия Telegram',
  ],

  [
    'Telegram ile giriş tamamlanamadı.',
    'Telegram login could not be completed.',
    'Не удалось завершить вход через Telegram.',
  ],

  [
    'Oturumunuz sona erdi. Lütfen tekrar giriş yapın.',
    'Your session has ended. Please sign in again.',
    'Сессия завершена. Войдите снова.',
  ],

  [
    'Oturum kapatıldı.',
    'Session closed.',
    'Сессия закрыта.',
  ],

  [
    'Dashboard sunucusuna ulaşılamadı. Tekrar deneyebilirsiniz.',
    'Could not reach the dashboard server. Please try again.',
    'Не удалось связаться с сервером панели. Попробуйте снова.',
  ],


  /*
   * Plans.
   */
  [
    'Planları görüntülemek için giriş yapın',
    'Sign in to view plans',
    'Войдите, чтобы посмотреть планы',
  ],

  [
    'Planlar ve ödeme seçenekleri Telegram hesabınıza bağlıdır.',
    'Plans and payment options are linked to your Telegram account.',
    'Планы и способы оплаты связаны с вашим аккаунтом Telegram.',
  ],

  [
    'Aktif plan yok',
    'No active plan',
    'Нет активного плана',
  ],

  [
    'Planını seç',
    'Choose your plan',
    'Выберите план',
  ],

  [
    'POPÜLER',
    'POPULAR',
    'ПОПУЛЯРНЫЙ',
  ],

  [
    'GÜN',
    'DAYS',
    'ДНЕЙ',
  ],

  [
    'USDT / TON ile öde',
    'Pay with USDT / TON',
    'Оплатить USDT / TON',
  ],

  [
    'Stars ile öde',
    'Pay with Stars',
    'Оплатить Stars',
  ],

  [
    'NACKL ile öde',
    'Pay with NACKL',
    'Оплатить NACKL',
  ],

  [
    'Ödeme talimatı hazırlanıyor…',
    'Preparing payment instructions…',
    'Подготовка инструкции по оплате…',
  ],

  [
    'Plan bilgisi alınamadı.',
    'Plan information could not be loaded.',
    'Не удалось загрузить информацию о планах.',
  ],

  [
    'PLAN VERİLERİ ALINIYOR…',
    'LOADING PLAN DATA…',
    'ЗАГРУЗКА ПЛАНОВ…',
  ],

  [
    'Cloud Miner aboneliğinizi yönetin ve kullanılabilir ödeme kanalını seçin.',
    'Manage your Cloud Miner subscription and choose an available payment method.',
    'Управляйте подпиской Cloud Miner и выберите доступный способ оплаты.',
  ],


  /*
   * Referrals.
   */
  [
    'Referans kodu geçersiz.',
    'Invalid referral code.',
    'Недействительный реферальный код.',
  ],

  [
    'Referans kodu bulunamadı.',
    'Referral code was not found.',
    'Реферальный код не найден.',
  ],

  [
    'Referans kodu bağlanamadı.',
    'Referral code could not be linked.',
    'Не удалось привязать реферальный код.',
  ],

  [
    'Referans kodu kaydedildi',
    'Referral code saved',
    'Реферальный код сохранён',
  ],

  [
    'Referans paneline giriş yapın',
    'Sign in to the referral panel',
    'Войдите в реферальную панель',
  ],

  [
    'Davet et, birlikte büyü',
    'Invite and grow together',
    'Приглашайте и развивайтесь вместе',
  ],

  [
    'Referans bilgileri alınamadı.',
    'Referral information could not be loaded.',
    'Не удалось загрузить реферальную информацию.',
  ],

  [
    'Referans linki panoya kopyalandı.',
    'Referral link copied to clipboard.',
    'Реферальная ссылка скопирована.',
  ],


  /*
   * Local Miner / Boost Farm.
   */
  [
    'GELİŞTİRME AŞAMASINDA',
    'IN DEVELOPMENT',
    'В РАЗРАБОТКЕ',
  ],

  [
    'Madencilik gücü kendi cihazınızda.',
    'Mining power on your own device.',
    'Майнинг на вашем устройстве.',
  ],

  [
    "Local Miner; Cloud Miner'dan farklı olarak kullanıcının kendi bilgisayar kaynaklarını kullanacağı bağımsız madencilik ürünü olarak planlanıyor.",
    'Local Miner is planned as a standalone mining product that uses the resources of your own computer instead of Cloud Miner infrastructure.',
    'Local Miner планируется как отдельный продукт для майнинга, использующий ресурсы вашего собственного компьютера.',
  ],

  [
    'Henüz kullanıma açılmadı',
    'Not available yet',
    'Пока недоступно',
  ],

  [
    'İndirme veya aktivasyon işlemi şu anda mevcut değil.',
    'Download or activation is not available yet.',
    'Загрузка и активация пока недоступны.',
  ],

  [
    'YEREL KAYNAKLAR',
    'LOCAL RESOURCES',
    'ЛОКАЛЬНЫЕ РЕСУРСЫ',
  ],

  [
    'DOĞRUDAN KATILIM',
    'DIRECT PARTICIPATION',
    'ПРЯМОЕ УЧАСТИЕ',
  ],

  [
    'MASAÜSTÜ DENEYİMİ',
    'DESKTOP EXPERIENCE',
    'НАСТОЛЬНЫЙ РЕЖИМ',
  ],

  [
    'Madencilik iş yükünün kullanıcının kendi bilgisayar kaynakları üzerinde çalışması hedefleniyor.',
    "The mining workload is intended to run on the user's own computer resources.",
    'Планируется, что майнинг будет выполняться на ресурсах компьютера пользователя.',
  ],

  [
    'Ürün vizyonu, kullanıcının Acki Nacki ağına kendi cihazından doğrudan katılması üzerine kurulu.',
    "The product vision is built around direct participation in the Acki Nacki network from the user's own device.",
    'Концепция продукта основана на прямом участии в сети Acki Nacki со своего устройства.',
  ],

  [
    "Cloud Miner'ın yanında ayrı bir masaüstü madencilik deneyimi olarak konumlandırılıyor.",
    'It is positioned as a separate desktop mining experience alongside Cloud Miner.',
    'Продукт позиционируется как отдельный настольный вариант майнинга рядом с Cloud Miner.',
  ],

  [
    'Madencilik kapasitesi için ölçekleme katmanı.',
    'Scaling layer for mining capacity.',
    'Слой масштабирования мощности майнинга.',
  ],

  [
    'Güç paketi satın alma veya Boost aktivasyonu şu anda mevcut değil.',
    'Power package purchases and Boost activation are not available yet.',
    'Покупка пакетов мощности и активация Boost пока недоступны.',
  ],

  [
    'GÜÇ PAKETLERİ',
    'POWER PACKAGES',
    'ПАКЕТЫ МОЩНОСТИ',
  ],

  [
    'ÖLÇEKLEME',
    'SCALING',
    'МАСШТАБИРОВАНИЕ',
  ],

  [
    'MERKEZİ İZLEME',
    'CENTRAL MONITORING',
    'ЦЕНТРАЛЬНЫЙ МОНИТОРИНГ',
  ],

  [
    'Ürün vizyonunda madencilik kapasitesinin dönemsel güç paketleriyle artırılması bulunuyor.',
    'The product vision includes increasing mining capacity with time-based power packages.',
    'Концепция предусматривает увеличение мощности майнинга с помощью временных пакетов.',
  ],

  [
    'Boost Farm, mevcut madencilik kapasitesinin üzerinde çalışan ayrı bir ölçekleme katmanı olarak konumlandırılıyor.',
    'Boost Farm is positioned as a separate scaling layer above existing mining capacity.',
    'Boost Farm позиционируется как отдельный слой масштабирования поверх текущей мощности майнинга.',
  ],

  [
    'Güç ve performans durumunun tek merkezden takip edilmesi ürünün temel hedeflerinden biri.',
    'Centralized monitoring of power and performance is one of the core product goals.',
    'Централизованный мониторинг мощности и производительности — одна из основных целей продукта.',
  ],


  /*
   * Support.
   */
  [
    'Dilek / İstek / Şikayet',
    'Feedback / Request / Complaint',
    'Обратная связь / Запрос / Жалоба',
  ],

  [
    'Geri bildiriminizi doğrudan Acki Nacki Radar ekibine iletin.',
    'Send your feedback directly to the Acki Nacki Radar team.',
    'Отправьте сообщение напрямую команде Acki Nacki Radar.',
  ],

  [
    'Dilek',
    'Suggestion',
    'Предложение',
  ],

  [
    'İstek',
    'Request',
    'Запрос',
  ],

  [
    'Şikayet',
    'Complaint',
    'Жалоба',
  ],

  [
    'Teknik Destek',
    'Technical Support',
    'Техническая поддержка',
  ],

  [
    'Konu',
    'Subject',
    'Тема',
  ],

  [
    'Mesajınızı ayrıntılı biçimde yazın',
    'Describe your message in detail',
    'Опишите сообщение подробно',
  ],

  [
    'E-posta hazırla',
    'Prepare email',
    'Подготовить письмо',
  ],

  [
    'Doğrudan iletişim',
    'Direct contact',
    'Прямая связь',
  ],

  [
    'Konu ve mesaj alanlarını doldurun.',
    'Complete the subject and message fields.',
    'Заполните тему и сообщение.',
  ],

  [
    'E-posta uygulaması açılıyor.',
    'Opening your email app.',
    'Открываем почтовое приложение.',
  ],

  [
    'NASIL ÇALIŞIR?',
    'HOW DOES IT WORK?',
    'КАК ЭТО РАБОТАЕТ?',
  ],

  [
    'Kategoriyi seçin.',
    'Choose a category.',
    'Выберите категорию.',
  ],

  [
    'Konu ve mesajınızı yazın.',
    'Enter your subject and message.',
    'Введите тему и сообщение.',
  ],

  [
    '“E-posta hazırla” düğmesine basın.',
    'Press “Prepare email”.',
    'Нажмите «Подготовить письмо».',
  ],

  [
    'Cihazınızdaki e-posta uygulamasında gönderimi onaylayın.',
    'Confirm sending in your device email application.',
    'Подтвердите отправку в почтовом приложении устройства.',
  ],

  [
    'ANA SAYFA →',
    'HOME →',
    'ГЛАВНАЯ →',
  ],


  /*
   * Compact footer.
   */
  [
    'GRUP',
    'GROUP',
    'ГРУППА',
  ],

  [
    'KANAL',
    'CHANNEL',
    'КАНАЛ',
  ],

  [
    'Telegram Grup',
    'Telegram Group',
    'Группа Telegram',
  ],

  [
    'Telegram Kanal',
    'Telegram Channel',
    'Канал Telegram',
  ],

  [
    'E-posta',
    'Email',
    'Почта',
  ],

  [
    'Acki Nacki Radar sosyal medya',
    'Acki Nacki Radar social media',
    'Социальные сети Acki Nacki Radar',
  ],

  /*
   * PHASE_7D2_DYNAMIC_CATALOG_20260816
   * Cloud Miner / Plans / Referrals /
   * Mining observability runtime strings.
   */

  [
    'YOK',
    'NONE',
    'НЕТ',
  ],

  [
    'ABONELİK YOK',
    'NO SUBSCRIPTION',
    'НЕТ ПОДПИСКИ',
  ],

  [
    'SÜRESİ DOLDU',
    'EXPIRED',
    'ИСТЕКЛА',
  ],

  [
    'BAĞLANTI HATASI',
    'CONNECTION ERROR',
    'ОШИБКА СОЕДИНЕНИЯ',
  ],

  [
    'Henüz çalışma kaydı yok',
    'No activity record yet',
    'Записей о работе пока нет',
  ],

  [
    'Cloud Miner servisi şu anda hazır değil.',
    'Cloud Miner service is not ready right now.',
    'Сервис Cloud Miner сейчас не готов.',
  ],

  [
    'Aktif aboneliğiniz yok. Önce bir plan etkinleştirin.',
    'You do not have an active subscription. Activate a plan first.',
    'У вас нет активной подписки. Сначала активируйте план.',
  ],

  [
    'Cüzdan adı gerekli.',
    'Wallet name is required.',
    'Необходимо имя кошелька.',
  ],

  [
    'Cüzdan doğrulaması başlatılamadı. Biraz sonra tekrar deneyin.',
    'Wallet verification could not be started. Please try again shortly.',
    'Не удалось запустить проверку кошелька. Попробуйте немного позже.',
  ],

  [
    'Bekleyen bir bağlantı bulunamadı.',
    'No pending connection was found.',
    'Ожидающее подключение не найдено.',
  ],

  [
    'Onay henüz zincirde görünmüyor.',
    'Approval is not visible on-chain yet.',
    'Подтверждение пока не появилось в сети.',
  ],

  [
    'Oturum sona erdi.',
    'Session has ended.',
    'Сессия завершена.',
  ],

  [
    'İşlem tamamlanamadı.',
    'The operation could not be completed.',
    'Не удалось выполнить операцию.',
  ],

  [
    'Önce cüzdan adını girin.',
    'Enter a wallet name first.',
    'Сначала введите имя кошелька.',
  ],

  [
    'Mining anahtarı hazırlanıyor…',
    'Preparing mining key…',
    'Подготовка ключа майнинга…',
  ],

  [
    'Cüzdan bağlandı ve Cloud Miner aktif.',
    'Wallet connected and Cloud Miner is active.',
    'Кошелёк подключён, Cloud Miner активен.',
  ],

  [
    'Cüzdan bağlandı. Başka aktif miner olduğu için bu cüzdan durdurulmuş durumda.',
    'Wallet connected. This wallet is stopped because another miner is already active.',
    'Кошелёк подключён. Он остановлен, потому что другой майнер уже активен.',
  ],

  [
    'Bağlantı durumu yenilendi.',
    'Connection status refreshed.',
    'Статус подключения обновлён.',
  ],

  [
    'LİNKİ KOPYALA',
    'COPY LINK',
    'КОПИРОВАТЬ ССЫЛКУ',
  ],

  [
    'Link kopyalanamadı.',
    'Could not copy the link.',
    'Не удалось скопировать ссылку.',
  ],

  [
    'Madenci bu işlem için uygun durumda değil.',
    'The miner is not in a valid state for this operation.',
    'Состояние майнера не позволяет выполнить эту операцию.',
  ],

  [
    'Planınız aynı anda yalnızca bir aktif mining cüzdanına izin veriyor. Önce diğer aktif cüzdanı durdurun.',
    'Your plan allows only one active mining wallet at a time. Stop the other active wallet first.',
    'Ваш план допускает только один активный майнинг-кошелёк одновременно. Сначала остановите другой активный кошелёк.',
  ],

  [
    'Miner kaydı bulunamadı.',
    'Miner record was not found.',
    'Запись майнера не найдена.',
  ],

  [
    'İŞLENİYOR…',
    'PROCESSING…',
    'ОБРАБОТКА…',
  ],

  [
    'KALDIRILIYOR…',
    'REMOVING…',
    'УДАЛЕНИЕ…',
  ],

  [
    'Sunucuya ulaşılamadı.',
    'Could not reach the server.',
    'Не удалось связаться с сервером.',
  ],

  [
    'Mining başladığında mevcut döngünün sağlık verileri burada görünecek.',
    'Current-cycle health data will appear here when mining starts.',
    'После запуска майнинга здесь появятся данные состояния текущего цикла.',
  ],

  [
    'Mevcut döngü toplamı kısmi başlangıç verisi içeriyor.',
    'The current cycle total includes partial starting data.',
    'Итог текущего цикла содержит частичные начальные данные.',
  ],

  [
    'Henüz reward ölçümü yok.',
    'No reward measurement yet.',
    'Данных по наградам пока нет.',
  ],

  [
    'USDT / TON ödemeleri şu anda kapalı.',
    'USDT / TON payments are currently unavailable.',
    'Оплата USDT / TON сейчас недоступна.',
  ],

  [
    'Geçersiz plan seçildi.',
    'Invalid plan selected.',
    'Выбран недействительный план.',
  ],

  [
    'NACKL ödemeleri şu anda kapalı.',
    'NACKL payments are currently unavailable.',
    'Оплата NACKL сейчас недоступна.',
  ],

  [
    'NACKL ödeme sistemi henüz zincir senkronizasyonunu tamamlamadı.',
    'The NACKL payment system has not completed chain synchronization yet.',
    'Платёжная система NACKL ещё не завершила синхронизацию с сетью.',
  ],

  [
    'Şu anda yeni NACKL ödeme kodu üretilemiyor. Bir süre sonra tekrar deneyin.',
    'A new NACKL payment code cannot be generated right now. Please try again later.',
    'Сейчас невозможно создать новый код оплаты NACKL. Попробуйте позже.',
  ],

  [
    'Telegram Stars ödemeleri şu anda kapalı.',
    'Telegram Stars payments are currently unavailable.',
    'Оплата Telegram Stars сейчас недоступна.',
  ],

  [
    'Telegram Stars ödeme bağlantısı oluşturulamadı.',
    'The Telegram Stars payment link could not be created.',
    'Не удалось создать ссылку для оплаты Telegram Stars.',
  ],

  [
    'Ödeme kanallarının kullanılabilirliği zincir ve ödeme servislerinin canlı durumuna göre otomatik belirlenir.',
    'Payment method availability is determined automatically from the live status of the chain and payment services.',
    'Доступность способов оплаты определяется автоматически по текущему состоянию сети и платёжных сервисов.',
  ],

  [
    'Memo / code alanını eksiksiz gönderin. Kod olmadan ödeme hesabınızla eşleştirilemez.',
    'Send the memo / code field exactly as shown. Without the code, the payment cannot be matched to your account.',
    'Укажите поле memo / code точно как показано. Без кода платёж нельзя связать с вашим аккаунтом.',
  ],

  [
    'NACKL ödemesi exact amount ile eşleştirilir. Ekrandaki küsurat dahil tam tutarı gönderin.',
    'NACKL payments are matched by exact amount. Send the full amount including the displayed decimals.',
    'Платежи NACKL сопоставляются по точной сумме. Отправьте всю сумму, включая указанные дробные значения.',
  ],

  [
    'USDT / TON ödeme talimatı hazır.',
    'USDT / TON payment instructions are ready.',
    'Инструкция по оплате USDT / TON готова.',
  ],

  [
    'NACKL ödeme talimatı hazır.',
    'NACKL payment instructions are ready.',
    'Инструкция по оплате NACKL готова.',
  ],

  [
    'Telegram ödeme bağlantısı doğrulanamadı.',
    'The Telegram payment link could not be verified.',
    'Не удалось проверить ссылку оплаты Telegram.',
  ],

  [
    'Bitiş tarihi alınamadı.',
    'End date could not be loaded.',
    'Не удалось получить дату окончания.',
  ],

  [
    'Kendi referans kodunuzu kullanamazsınız.',
    'You cannot use your own referral code.',
    'Нельзя использовать собственный реферальный код.',
  ],

  [
    'Hesabınız daha önce başka bir referansa bağlanmış.',
    'Your account has already been linked to another referral.',
    'Ваш аккаунт уже привязан к другому рефералу.',
  ],

  [
    'Ücretli abonelik başladıktan sonra referans kodu eklenemez.',
    'A referral code cannot be added after a paid subscription has started.',
    'После начала платной подписки добавить реферальный код нельзя.',
  ],

  [
    'Referans bağlantınız zaten kayıtlı.',
    'Your referral link is already registered.',
    'Ваша реферальная ссылка уже зарегистрирована.',
  ],

  [
    'Referans kodu hesabınıza bağlandı.',
    'Referral code linked to your account.',
    'Реферальный код привязан к вашему аккаунту.',
  ],

  [
    'Referans kodu şu anda bağlanamadı. Kod saklandı ve sonraki girişte tekrar denenecek.',
    'The referral code could not be linked right now. It was saved and will be retried on your next sign-in.',
    'Сейчас не удалось привязать реферальный код. Код сохранён, и попытка повторится при следующем входе.',
  ],

  [
    'Oturumunuz sona erdi. Referans kodunuz saklandı; tekrar giriş yapın.',
    'Your session has ended. Your referral code was saved; sign in again.',
    'Сессия завершена. Реферальный код сохранён; войдите снова.',
  ],

  [
    'Telegram ile giriş yaptıktan sonra referans kodu hesabınıza otomatik olarak bağlanacak.',
    'After signing in with Telegram, the referral code will be linked to your account automatically.',
    'После входа через Telegram реферальный код будет автоматически привязан к аккаунту.',
  ],

  [
    'Davet linkinizi ve referral istatistiklerinizi görmek için Telegram hesabınızla giriş yapın.',
    'Sign in with Telegram to view your invitation link and referral statistics.',
    'Войдите через Telegram, чтобы увидеть ссылку приглашения и реферальную статистику.',
  ],


  /*
   * PHASE_7D3_VISIBLE_RESIDUALS_20260816
   * Exact strings found by 7-route EN/RU
   * visible residual audit.
   */

  [
    'Cüzdanlarınızı, madencilik durumunu, epoch ve ödül akışını ayrı Cloud Miner ekranından yönetin.',
    'Manage your wallets, mining status, epoch and reward flow from the dedicated Cloud Miner screen.',
    'Управляйте кошельками, статусом майнинга, эпохой и потоком наград на отдельном экране Cloud Miner.',
  ],

  [
    "CLOUD MINER'A GİT",
    'GO TO CLOUD MINER',
    'ПЕРЕЙТИ В CLOUD MINER',
  ],

  [
    'Canlı sistem durumu',
    'Live system status',
    'Текущий статус системы',
  ],

  [
    'Madencilik hesabınıza bağlı güvenli kontrol alanı.',
    'Secure control area linked to your mining account.',
    'Безопасная панель управления, связанная с вашим майнинг-аккаунтом.',
  ],

  [
    'GİRİŞ GEREKLİ',
    'SIGN-IN REQUIRED',
    'ТРЕБУЕТСЯ ВХОД',
  ],

  [
    "Mining Console'a giriş",
    'Sign in to Mining Console',
    'Вход в Mining Console',
  ],

  [
    "Cloud Miner hesabınız Telegram hesabınızla doğrulanır. Madencilik anahtarları veya cüzdan private key'i tarayıcıya gönderilmez.",
    'Your Cloud Miner account is verified with your Telegram account. Mining keys or the wallet private key are not sent to the browser.',
    'Ваш аккаунт Cloud Miner подтверждается через аккаунт Telegram. Ключи майнинга и приватный ключ кошелька не передаются в браузер.',
  ],

  [
    'Doğrulama tamamlandığında Cloud Miner ekranına geri dönersiniz.',
    'After verification is complete, you will return to the Cloud Miner screen.',
    'После завершения проверки вы вернётесь на экран Cloud Miner.',
  ],

  [
    'Kendi bilgisayarınızın kaynaklarını kullanarak Acki Nacki ağına doğrudan katılacağınız masaüstü madenci deneyimi.',
    "A desktop miner experience that lets you participate directly in the Acki Nacki network using your computer's resources.",
    'Десктопный майнер, позволяющий напрямую участвовать в сети Acki Nacki, используя ресурсы вашего компьютера.',
  ],

  [
    'Madencilik kapasitenizi dönemsel güç paketleriyle büyütüp performansı tek merkezden izleyeceğiniz ölçekleme katmanı.',
    'A scaling layer for expanding mining capacity with periodic power packages and monitoring performance from one place.',
    'Слой масштабирования для увеличения мощности майнинга с помощью периодических пакетов мощности и централизованного мониторинга производительности.',
  ],

  [
    'Boost Farm; madencilik kapasitesini dönemsel güç paketleriyle büyütmeyi ve performansı tek merkezden izlemeyi amaçlayan ürün olarak planlanıyor.',
    'Boost Farm is planned as a product for increasing mining capacity with periodic power packages and monitoring performance from one place.',
    'Boost Farm планируется как продукт для увеличения мощности майнинга с помощью периодических пакетов мощности и централизованного мониторинга производительности.',
  ],

  [
    "Arkadaşlarını davet et, ücretli aboneliğe dönüşen referral'larla abonelik süresi kazan.",
    'Invite friends and earn subscription time from referrals that convert to paid subscriptions.',
    'Приглашайте друзей и получайте дополнительное время подписки за рефералов, оформивших платную подписку.',
  ],

  [
    'PLANLAR →',
    'PLANS →',
    'ПЛАНЫ →',
  ],

  [
    'Form mesajınızı hazırlar ve cihazınızdaki varsayılan e-posta uygulamasını açar.',
    'The form prepares your message and opens the default email app on your device.',
    'Форма подготовит сообщение и откроет почтовое приложение по умолчанию на вашем устройстве.',
  ],

  [
    'KATEGORİ',
    'CATEGORY',
    'КАТЕГОРИЯ',
  ],

  [
    'KONU',
    'SUBJECT',
    'ТЕМА',
  ],

  [
    'MESAJ',
    'MESSAGE',
    'СООБЩЕНИЕ',
  ],

  [
    'E-POSTA HAZIRLA',
    'PREPARE EMAIL',
    'ПОДГОТОВИТЬ ПИСЬМО',
  ],

  [
    'Daha hızlı iletişim için Telegram botunu kullanabilir veya doğrudan e-posta gönderebilirsiniz.',
    'For faster contact, use the Telegram bot or send an email directly.',
    'Для более быстрой связи используйте Telegram-бота или отправьте письмо напрямую.',
  ],


  /*
   * PHASE_7D4_AUTH_STATIC_20260816
   * Authenticated Cloud / Plans / Referrals
   */

  [
    'ÇIKIŞ',
    'LOG OUT',
    'ВЫЙТИ',
  ],

  [
    'BAĞLI CÜZDAN',
    'CONNECTED WALLET',
    'ПОДКЛЮЧЕННЫЙ КОШЕЛЁК',
  ],

  [
    'ABONELİK',
    'SUBSCRIPTION',
    'ПОДПИСКА',
  ],

  [
    'KALAN SÜRE',
    'TIME REMAINING',
    'ОСТАВШЕЕСЯ ВРЕМЯ',
  ],

  [
    'CÜZDAN BAĞLA',
    'CONNECT WALLET',
    'ПОДКЛЮЧИТЬ КОШЕЛЁК',
  ],

  [
    'AN Wallet üzerinden mining anahtarı onayı gerekir.',
    'Mining key authorization via AN Wallet is required.',
    'Требуется подтверждение ключа майнинга через AN Wallet.',
  ],

  [
    'KALAN',
    'REMAINING',
    'ОСТАЛОСЬ',
  ],

  [
    'BİTİŞ',
    'END',
    'ОКОНЧАНИЕ',
  ],

  [
    '262.000 blok tabanlı gerçek mining döngüsü',
    'Real 262,000-block mining cycle',
    'Реальный цикл майнинга на 262 000 блоков',
  ],

  [
    'DÖNGÜ BAŞLANGICI',
    'CYCLE START',
    'НАЧАЛО ЦИКЛА',
  ],

  [
    'KALAN TAHMİNİ SÜRE',
    'EST. TIME REMAINING',
    'РАСЧЁТНОЕ ОСТАВШЕЕСЯ ВРЕМЯ',
  ],

  [
    'DÖNGÜ BİTİŞİ',
    'CYCLE END',
    'КОНЕЦ ЦИКЛА',
  ],

  [
    'DÖNGÜ BLOĞU',
    'CYCLE BLOCK',
    'БЛОК ЦИКЛА',
  ],

  [
    'TAHMİNİ DÖNGÜ SÜRESİ',
    'EST. CYCLE DURATION',
    'РАСЧЁТНАЯ ДЛИТЕЛЬНОСТЬ ЦИКЛА',
  ],

  [
    'MEVCUT MINING DÖNGÜSÜ',
    'CURRENT MINING CYCLE',
    'ТЕКУЩИЙ ЦИКЛ МАЙНИНГА',
  ],

  [
    'DİKKAT',
    'WARNING',
    'ВНИМАНИЕ',
  ],

  [
    'BAŞARI',
    'SUCCESS',
    'УСПЕХ',
  ],

  [
    'BAŞARILI',
    'SUCCESSFUL',
    'УСПЕШНО',
  ],

  [
    'MEVCUT DÖNGÜ TOPLAMI',
    'CURRENT CYCLE TOTAL',
    'ИТОГ ТЕКУЩЕГО ЦИКЛА',
  ],

  [
    'Cloud Miner verileri bağlı.',
    'Cloud Miner data connected.',
    'Данные Cloud Miner подключены.',
  ],

  [
    'Cloud Miner verileri, cüzdan bağlantıları ve madenci kontrolleri bu panelden yönetilir.',
    'Cloud Miner data, wallet connections, and miner controls are managed from this panel.',
    'Данные Cloud Miner, подключения кошельков и управление майнерами доступны на этой панели.',
  ],

  [
    'Ücretli aboneliğe dönüşen davetlerle Cloud Miner abonelik süresi kazan.',
    'Earn Cloud Miner subscription time from invitations that convert to paid subscriptions.',
    'Получайте дополнительное время подписки Cloud Miner за приглашённых пользователей, оформивших платную подписку.',
  ],

  [
    'DAVET',
    'INVITED',
    'ПРИГЛАШЕНО',
  ],

  [
    'Referans koduyla bağlanan',
    'Linked with referral code',
    'Привязано по реферальному коду',
  ],

  [
    'ÜCRETLİ',
    'PAID',
    'ОПЛАЧЕНО',
  ],

  [
    'Ücretli plana dönüşen',
    'Converted to a paid plan',
    'Перешли на платный план',
  ],

  [
    'KAZANILAN GÜN',
    'DAYS EARNED',
    'ПОЛУЧЕНО ДНЕЙ',
  ],

  [
    'Aboneliğe eklenen toplam süre',
    'Total time added to subscription',
    'Общее время, добавленное к подписке',
  ],

  [
    'REFERANS LİNKİN',
    'YOUR REFERRAL LINK',
    'ВАША РЕФЕРАЛЬНАЯ ССЫЛКА',
  ],

  [
    'Arkadaşların bu link üzerinden giriş yapmalı.',
    'Friends should sign in through this link.',
    'Друзья должны войти по этой ссылке.',
  ],

  [
    'SONRAKİ HEDEF',
    'NEXT TARGET',
    'СЛЕДУЮЩАЯ ЦЕЛЬ',
  ],

  [
    'TAMAMLANDI',
    'COMPLETED',
    'ВЫПОЛНЕНО',
  ],

  [
    'HEDEF',
    'TARGET',
    'ЦЕЛЬ',
  ],

  [
    'Davet edilen kullanıcı önce referans koduyla hesabınıza bağlanır.',
    'The invited user is first linked to your account through the referral code.',
    'Приглашённый пользователь сначала привязывается к вашему аккаунту по реферальному коду.',
  ],

  [
    'Referral ancak gerçek ücretli abonelik aldığında “Ücretli” sayılır.',
    'A referral counts as paid only after purchasing a real paid subscription.',
    'Реферал считается платным только после оформления реальной платной подписки.',
  ],

  [
    'Trial ve test planları ücretli referral sayılmaz.',
    'Trial and test plans do not count as paid referrals.',
    'Пробные и тестовые планы не считаются платными рефералами.',
  ],

  [
    'Referral bağlantısı kalıcıdır; sonradan başka referrera taşınamaz.',
    'The referral relationship is permanent and cannot later be moved to another referrer.',
    'Реферальная связь постоянна и не может быть перенесена к другому рефереру.',
  ],

  /*
   * PHASE_7L_I18N_COMPLETION_V6_20260817
   *
   * Late UI + accessibility/ARIA coverage.
   */


  /* =========================
     GLOBAL / FOOTER / HOME
     ========================= */

  [
    'Acki Nacki ağını, madencilik akışını ve canlı zincir verilerini tek merkezden takip edin.',
    'Track the Acki Nacki network, mining flow, and live chain data from one place.',
    'Отслеживайте сеть Acki Nacki, майнинг и данные блокчейна в реальном времени в одном месте.',
  ],

  [
    'PLATFORM',
    'PLATFORM',
    'ПЛАТФОРМА',
  ],

  [
    'Platform',
    'Platform',
    'Платформа',
  ],

  [
    'MADENCİLİK & ARAÇLAR',
    'MINING & TOOLS',
    'МАЙНИНГ И ИНСТРУМЕНТЫ',
  ],

  [
    'TOPLULUK',
    'COMMUNITY',
    'СООБЩЕСТВО',
  ],

  [
    'Topluluk',
    'Community',
    'Сообщество',
  ],

  [
    'KAYNAKLAR',
    'SOURCES',
    'ИСТОЧНИКИ',
  ],

  [
    'Kaynaklar',
    'Sources',
    'Источники',
  ],

  [
    'Mining araçları',
    'Mining tools',
    'Инструменты майнинга',
  ],

  [
    'Sosyal medya',
    'Social media',
    'Социальные сети',
  ],

  [
    'BAĞIMSIZ TOPLULUK PROJESİ',
    'INDEPENDENT COMMUNITY PROJECT',
    'НЕЗАВИСИМЫЙ ПРОЕКТ СООБЩЕСТВА',
  ],

  [
    "Acki Nacki Radar bağımsız ve topluluk tarafından geliştirilen bir platformdur. Acki Nacki'nin resmi sitesi, ürünü veya temsilcisi değildir.",
    'Acki Nacki Radar is an independent, community-developed platform. It is not an official Acki Nacki site, product, or representative.',
    'Acki Nacki Radar — независимая платформа, разработанная сообществом. Она не является официальным сайтом, продуктом или представителем Acki Nacki.',
  ],

  [
    'Geliştirici Belgeleri',
    'Developer Docs',
    'Документация для разработчиков',
  ],

  [
    'Resmi Telegram',
    'Official Telegram',
    'Официальный Telegram',
  ],

  [
    'Telegram Topluluğu',
    'Telegram Community',
    'Сообщество Telegram',
  ],

  [
    'MAINNET ANALİZİ',
    'MAINNET INTELLIGENCE',
    'АНАЛИТИКА MAINNET',
  ],

  [
    'MAINNET · CANLI AĞ VERİSİ',
    'MAINNET · LIVE NETWORK DATA',
    'MAINNET · ДАННЫЕ СЕТИ В РЕАЛЬНОМ ВРЕМЕНИ',
  ],

  [
    'UTC saati',
    'UTC time',
    'Время UTC',
  ],

  [
    'Menüyü aç',
    'Open menu',
    'Открыть меню',
  ],

  [
    'Menüyü kapat',
    'Close menu',
    'Закрыть меню',
  ],


  /* =========================
     HEADER / NAV ARIA
     ========================= */

  [
    'Cüzdan arama',
    'Wallet search',
    'Поиск кошелька',
  ],

  [
    'Dil',
    'Language',
    'Язык',
  ],

  [
    'Ana navigasyon',
    'Main navigation',
    'Основная навигация',
  ],

  [
    'Mobil navigasyon',
    'Mobile navigation',
    'Мобильная навигация',
  ],

  [
    'Mobil dil',
    'Language mobile',
    'Язык на мобильном устройстве',
  ],


  /* =========================
     HOME ARIA / METRICS
     ========================= */

  [
    'Acki Nacki mainnet metrikleri',
    'Acki Nacki mainnet metrics',
    'Метрики mainnet Acki Nacki',
  ],

  [
    'Radar tarama metrikleri',
    'Radar scan metrics',
    'Метрики сканирования радара',
  ],


  /* =========================
     HOME STATUS / HUD
     ========================= */

  [
    'DİL',
    'LANGUAGE',
    'ЯЗЫК',
  ],

  [
    'CANLI / ZİNCİR',
    'LIVE / CHAIN',
    'ОНЛАЙН / ЦЕПОЧКА',
  ],

  [
    '24SA / AKIŞ',
    '24H / FLOW',
    '24Ч / ПОТОК',
  ],

  [
    'RADAR / İZLENEN',
    'RADAR / TRACKED',
    'РАДАР / ОТСЛЕЖИВАЕТСЯ',
  ],

  [
    'ZİNCİR / GECİKME',
    'CHAIN / LATENCY',
    'ЦЕПОЧКА / ЗАДЕРЖКА',
  ],

  [
    'CANLI / TPS',
    'LIVE / TPS',
    'ОНЛАЙН / TPS',
  ],

  [
    'TARAMA /',
    'SCAN /',
    'СКАНИРОВАНИЕ /',
  ],

  [
    'DÖNÜŞ /',
    'ROTATION /',
    'ВРАЩЕНИЕ /',
  ],

  [
    'AĞ /',
    'NETWORK /',
    'СЕТЬ /',
  ],

  [
    'MOD /',
    'MODE /',
    'РЕЖИМ /',
  ],

  [
    'HAZIR',
    'READY',
    'ГОТОВО',
  ],

  [
    'MAINNET · GÜVENLİ OIDC',
    'MAINNET · SECURE OIDC',
    'MAINNET · БЕЗОПАСНЫЙ OIDC',
  ],


  /* =========================
     CLOUD MINER
     ========================= */

  [
    'Madencilik Konsolu',
    'Mining Console',
    'Консоль майнинга',
  ],

  [
    'ÖDÜL AKIŞI',
    'REWARD FEED',
    'ЛЕНТА НАГРАД',
  ],

  [
    'ONAY BEKLENİYOR · DEVAM EDİYOR',
    'PENDING AUTHORIZATION · IN PROGRESS',
    'ОЖИДАНИЕ АВТОРИЗАЦИИ · В ПРОЦЕССЕ',
  ],

  [
    'CLOUD MINER KONTROLÜ',
    'CLOUD MINER CONTROL',
    'УПРАВЛЕНИЕ CLOUD MINER',
  ],


  /* =========================
     LOCAL MINER
     ========================= */

  [
    'YEREL HESAPLAMA / YOL HARİTASI',
    'LOCAL COMPUTE / ROADMAP',
    'ЛОКАЛЬНЫЕ ВЫЧИСЛЕНИЯ / ПЛАН РАЗВИТИЯ',
  ],

  [
    'CİHAZ HESAPLAMA',
    'DEVICE COMPUTE',
    'ВЫЧИСЛЕНИЯ НА УСТРОЙСТВЕ',
  ],

  [
    'GELİŞTİRME',
    'DEVELOPMENT',
    'РАЗРАБОТКА',
  ],

  [
    '01 / ÜRÜN',
    '01 / PRODUCT',
    '01 / ПРОДУКТ',
  ],

  [
    'ÜRÜN YOL HARİTASI',
    'PRODUCT ROADMAP',
    'ПЛАН РАЗВИТИЯ ПРОДУКТА',
  ],


  /* =========================
     BOOST FARM
     ========================= */

  [
    'MADENCİLİK GÜCÜ / YOL HARİTASI',
    'MINING POWER / ROADMAP',
    'МОЩНОСТЬ МАЙНИНГА / ПЛАН РАЗВИТИЯ',
  ],

  [
    'GÜÇLENDİRME',
    'BOOST',
    'УСИЛЕНИЕ',
  ],

  [
    '02 / ÜRÜN',
    '02 / PRODUCT',
    '02 / ПРОДУКТ',
  ],


  /* =========================
     PLANS
     ========================= */

  [
    'ABONELİK / ÖDEME',
    'SUBSCRIPTION / PAYMENT',
    'ПОДПИСКА / ОПЛАТА',
  ],

  [
    'ABONELİK ERİŞİMİ',
    'SUBSCRIPTION ACCESS',
    'ДОСТУП ПО ПОДПИСКЕ',
  ],


  /* =========================
     REFERRALS
     ========================= */

  [
    'TOPLULUK / BÜYÜME',
    'COMMUNITY / GROWTH',
    'СООБЩЕСТВО / РОСТ',
  ],

  [
    'TOPLULUK ERİŞİMİ',
    'COMMUNITY ACCESS',
    'ДОСТУП СООБЩЕСТВА',
  ],


  /* =========================
     SUPPORT
     ========================= */

  [
    'DESTEK / GERİ BİLDİRİM',
    'SUPPORT / FEEDBACK',
    'ПОДДЕРЖКА / ОБРАТНАЯ СВЯЗЬ',
  ],

  [
    'DOĞRUDAN İLETİŞİM',
    'DIRECT CONTACT',
    'ПРЯМАЯ СВЯЗЬ',
  ],

  [
    '01 / MESAJ',
    '01 / MESSAGE',
    '01 / СООБЩЕНИЕ',
  ],

  [
    'Maksimum 120 karakter',
    'Maximum 120 characters',
    'Максимум 120 символов',
  ],

  [
    'Maksimum 2000 karakter',
    'Maximum 2000 characters',
    'Максимум 2000 символов',
  ],

  [
    '02 / DOĞRUDAN',
    '02 / DIRECT',
    '02 / НАПРЯМУЮ',
  ],

  [
    'E-POSTA',
    'EMAIL',
    'ЭЛ. ПОЧТА',
  ],

  [
    'Kategori',
    'Category',
    'Категория',
  ],

  [
    'ACKI NACKI RADAR · DESTEK',
    'ACKI NACKI RADAR · SUPPORT',
    'ACKI NACKI RADAR · ПОДДЕРЖКА',
  ],


];


const LANG_INDEX:
  Record<UiLang, number> = {
    tr: 0,
    en: 1,
    ru: 2,
  };


export function uiText(
  tr: string,
  en: string,
  ru: string,
  lang:
    UiLang =
      getUiLanguage(),
): string {

  if (lang === 'en') {
    return en;
  }

  if (lang === 'ru') {
    return ru;
  }

  return tr;
}


function normalize(
  value: string,
): string {

  return value
    .replace(
      /\s+/g,
      ' '
    )
    .trim();
}


const REVERSE =
  new Map<
    string,
    Translation
  >();


for (
  const row
  of CATALOG
) {

  for (
    const variant
    of row
  ) {

    REVERSE.set(
      normalize(
        variant
      ),
      row
    );
  }
}


export function getUiLanguage():
  UiLang {

  const stored =
    window.localStorage.getItem(
      LANGUAGE_KEY
    );


  if (
    stored === 'tr' ||
    stored === 'en' ||
    stored === 'ru'
  ) {

    return stored;
  }


  return 'tr';
}


export function getUiLocale(
  lang:
    UiLang =
      getUiLanguage(),
): string {

  return LOCALE[lang];
}


function exactTranslation(
  value: string,
  lang: UiLang,
): string | null {

  const row =
    REVERSE.get(
      normalize(
        value
      )
    );


  if (!row) {
    return null;
  }


  return row[
    LANG_INDEX[lang]
  ];
}


function pluralDays(
  value: number,
  lang: UiLang,
): string {

  if (lang === 'tr') {
    return `${value} gün`;
  }

  if (lang === 'en') {
    return `${value} ${
      value === 1
        ? 'day'
        : 'days'
    }`;
  }

  return `${value} дн.`;
}


function dynamicTranslation(
  value: string,
  lang: UiLang,
): string | null {

  // Number-bearing strings cannot be matched by the exact-string catalog,
  // so they go through the regex path instead. Nothing renders a bare
  // "N dakika" today, but the pattern is cheap and the next countdown that
  // appears will already be translated.
  let match =
    value.match(
      /^(\d+)\s+dakika$/
    ) ||
    value.match(
      /^(\d+)\s+minutes?$/
    ) ||
    value.match(
      /^(\d+)\s+мин\.$/
    );

  if (match) {

    const n =
      Number(
        match[1]
      );


    return lang === 'tr'
      ? `${n} dakika`
      : lang === 'en'
        ? `${n} ${n === 1 ? 'minute' : 'minutes'}`
        : `${n} мин.`;
  }


  match =
    value.match(
      /^(\d+)\s+gün$/
    ) ||
    value.match(
      /^(\d+)\s+days?$/
    ) ||
    value.match(
      /^(\d+)\s+дн\.$/
    );


  if (match) {

    return pluralDays(
      Number(
        match[1]
      ),
      lang
    );
  }


  match =
    value.match(
      /^(\d+)\s+dk önce$/
    ) ||
    value.match(
      /^(\d+)\s+min ago$/
    ) ||
    value.match(
      /^(\d+)\s+мин\. назад$/
    );


  if (match) {

    const n =
      Number(
        match[1]
      );


    return lang === 'tr'
      ? `${n} dk önce`
      : lang === 'en'
        ? `${n} min ago`
        : `${n} мин. назад`;
  }


  match =
    value.match(
      /^(\d+)\s+sa önce$/
    ) ||
    value.match(
      /^(\d+)\s+h ago$/
    ) ||
    value.match(
      /^(\d+)\s+ч\. назад$/
    );


  if (match) {

    const n =
      Number(
        match[1]
      );


    return lang === 'tr'
      ? `${n} sa önce`
      : lang === 'en'
        ? `${n} h ago`
        : `${n} ч. назад`;
  }


  match =
    value.match(
      /^(\d+)\s+gün önce$/
    ) ||
    value.match(
      /^(\d+)\s+days? ago$/
    ) ||
    value.match(
      /^(\d+)\s+дн\. назад$/
    );


  if (match) {

    const n =
      Number(
        match[1]
      );


    return lang === 'tr'
      ? `${n} gün önce`
      : lang === 'en'
        ? `${n} ${
            n === 1
              ? 'day'
              : 'days'
          } ago`
        : `${n} дн. назад`;
  }


  if (
    value === 'az önce' ||
    value === 'just now' ||
    value === 'только что'
  ) {

    return lang === 'tr'
      ? 'az önce'
      : lang === 'en'
        ? 'just now'
        : 'только что';
  }


  match =
    value.match(
      /^Son tur:\s*(.+)$/
    ) ||
    value.match(
      /^Last run:\s*(.+)$/
    ) ||
    value.match(
      /^Последний запуск:\s*(.+)$/
    );


  if (match) {

    return lang === 'tr'
      ? `Son tur: ${match[1]}`
      : lang === 'en'
        ? `Last run: ${match[1]}`
        : `Последний запуск: ${match[1]}`;
  }


  match =
    value.match(
      /^Son claim:\s*(.+)$/
    ) ||
    value.match(
      /^Last claim:\s*(.+)$/
    ) ||
    value.match(
      /^Последний claim:\s*(.+)$/
    );


  if (match) {

    return lang === 'tr'
      ? `Son claim: ${match[1]}`
      : lang === 'en'
        ? `Last claim: ${match[1]}`
        : `Последний claim: ${match[1]}`;
  }


  match =
    value.match(
      /^Hata:\s*(.+)$/
    ) ||
    value.match(
      /^Error:\s*(.+)$/
    ) ||
    value.match(
      /^Ошибка:\s*(.+)$/
    );


  if (match) {

    return lang === 'tr'
      ? `Hata: ${match[1]}`
      : lang === 'en'
        ? `Error: ${match[1]}`
        : `Ошибка: ${match[1]}`;
  }


  /*
   * PHASE_7D2_DYNAMIC_PATTERNS_20260816
   */

  match =
    value.match(
      /^(.+) başlatıldı\.$/
    ) ||
    value.match(
      /^(.+) started\.$/
    ) ||
    value.match(
      /^(.+) запущен\.$/
    );


  if (match) {

    return lang === 'tr'
      ? `${match[1]} başlatıldı.`
      : lang === 'en'
        ? `${match[1]} started.`
        : `${match[1]} запущен.`;
  }


  match =
    value.match(
      /^(.+) durduruldu\.$/
    ) ||
    value.match(
      /^(.+) stopped\.$/
    ) ||
    value.match(
      /^(.+) остановлен\.$/
    );


  if (match) {

    return lang === 'tr'
      ? `${match[1]} durduruldu.`
      : lang === 'en'
        ? `${match[1]} stopped.`
        : `${match[1]} остановлен.`;
  }


  match =
    value.match(
      /^(.+) Cloud Miner hizmetinden kaldırıldı\.$/
    ) ||
    value.match(
      /^(.+) was removed from Cloud Miner\.$/
    ) ||
    value.match(
      /^(.+) удалён из Cloud Miner\.$/
    );


  if (match) {

    return lang === 'tr'
      ? `${match[1]} Cloud Miner hizmetinden kaldırıldı.`
      : lang === 'en'
        ? `${match[1]} was removed from Cloud Miner.`
        : `${match[1]} удалён из Cloud Miner.`;
  }


  match =
    value.match(
      /^(.+) · işlem yapılıyor…$/
    ) ||
    value.match(
      /^(.+) · processing…$/
    ) ||
    value.match(
      /^(.+) · обработка…$/
    );


  if (match) {

    return lang === 'tr'
      ? `${match[1]} · işlem yapılıyor…`
      : lang === 'en'
        ? `${match[1]} · processing…`
        : `${match[1]} · обработка…`;
  }


  match =
    value.match(
      /^Toplam ödül seviyesi:\s*(\d+)\s*gün$/
    ) ||
    value.match(
      /^Total reward level:\s*(\d+)\s*days?$/
    ) ||
    value.match(
      /^Общий уровень награды:\s*(\d+)\s*дн\.$/
    );


  if (match) {

    const days =
      Number(
        match[1]
      );


    return lang === 'tr'
      ? `Toplam ödül seviyesi: ${days} gün`
      : lang === 'en'
        ? `Total reward level: ${days} ${
            days === 1
              ? 'day'
              : 'days'
          }`
        : `Общий уровень награды: ${days} дн.`;
  }


  match =
    value.match(
      /^Bitiş:\s*(.+)$/
    ) ||
    value.match(
      /^Ends:\s*(.+)$/
    ) ||
    value.match(
      /^Окончание:\s*(.+)$/
    );


  if (match) {

    return lang === 'tr'
      ? `Bitiş: ${match[1]}`
      : lang === 'en'
        ? `Ends: ${match[1]}`
        : `Окончание: ${match[1]}`;
  }


  match =
    value.match(
      /^İşlem tamamlanamadı · HTTP (\d+)$/
    ) ||
    value.match(
      /^Operation failed · HTTP (\d+)$/
    ) ||
    value.match(
      /^Операция не выполнена · HTTP (\d+)$/
    );


  if (match) {

    return lang === 'tr'
      ? `İşlem tamamlanamadı · HTTP ${match[1]}`
      : lang === 'en'
        ? `Operation failed · HTTP ${match[1]}`
        : `Операция не выполнена · HTTP ${match[1]}`;
  }


  return null;
}



/*
 * PHASE_7D4_AUTH_DYNAMIC_20260816
 *
 * Authenticated runtime values containing
 * numbers / relative time.
 */
function phase7d4DynamicTranslation(
  value: string,
  lang: UiLang,
): string | null {

  const pick =
    (
      tr: string,
      en: string,
      ru: string,
    ): string => {

      if (lang === 'en') {
        return en;
      }

      if (lang === 'ru') {
        return ru;
      }

      return tr;
    };


  if (
    /^(az önce|just now|только что)$/i.test(
      value
    )
  ) {

    return pick(
      'az önce',
      'just now',
      'только что'
    );
  }


  const minute =
    value.match(
      /^(\d+)\s+(?:dk önce|min(?:ute)?s? ago|мин\.? назад)$/i
    );

  if (minute) {

    const n =
      Number(
        minute[1]
      );

    return pick(
      `${n} dk önce`,
      `${n} min ago`,
      `${n} мин. назад`
    );
  }


  const hour =
    value.match(
      /^(\d+)\s+(?:sa önce|hours? ago|ч\.? назад)$/i
    );

  if (hour) {

    const n =
      Number(
        hour[1]
      );

    return pick(
      `${n} sa önce`,
      `${n} ${n === 1 ? 'hour' : 'hours'} ago`,
      `${n} ч. назад`
    );
  }


  const dayAgo =
    value.match(
      /^(\d+)\s+(?:gün önce|days? ago|дн\.? назад)$/i
    );

  if (dayAgo) {

    const n =
      Number(
        dayAgo[1]
      );

    return pick(
      `${n} gün önce`,
      `${n} ${n === 1 ? 'day' : 'days'} ago`,
      `${n} дн. назад`
    );
  }


  const prefixed =
    value.match(
      /^(Last run|Последний запуск|Last claim|Последний claim|Son çalışma|Son claim):\s*(.+)$/i
    );

  if (prefixed) {

    const rawPrefix =
      prefixed[1]
        .toLocaleLowerCase();

    const isClaim =
      rawPrefix.includes(
        'claim'
      );

    const tail =
      phase7d4DynamicTranslation(
        prefixed[2],
        lang
      );

    if (tail) {

      const prefix =
        isClaim
          ? pick(
              'Son claim',
              'Last claim',
              'Последний claim'
            )
          : pick(
              'Son çalışma',
              'Last run',
              'Последний запуск'
            );

      return `${prefix}: ${tail}`;
    }
  }


  const referralProgress =
    value.match(
      /^(\d+)\s*\/\s*(\d+)\s*·\s*(\d+)\s+(?:GÜN|DAYS?|ДНЕЙ)$/i
    );

  if (referralProgress) {

    const current =
      referralProgress[1];

    const target =
      referralProgress[2];

    const days =
      referralProgress[3];

    return pick(
      `${current} / ${target} · ${days} GÜN`,
      `${current} / ${target} · ${days} DAYS`,
      `${current} / ${target} · ${days} ДНЕЙ`
    );
  }


  const planDays =
    value.match(
      /^(\d+)\s+(?:GÜN|DAYS?|ДНЕЙ)$/i
    );

  if (planDays) {

    const n =
      Number(
        planDays[1]
      );

    return pick(
      `${n} GÜN`,
      `${n} ${n === 1 ? 'DAY' : 'DAYS'}`,
      `${n} ДНЕЙ`
    );
  }


  const equivalentTr =
    value.match(
      /^\$([0-9]+(?:[.,][0-9]+)?)\s+karşılığı$/i
    );

  const equivalentEn =
    value.match(
      /^\$([0-9]+(?:[.,][0-9]+)?)\s+equivalent$/i
    );

  const equivalentRu =
    value.match(
      /^эквивалент\s+\$([0-9]+(?:[.,][0-9]+)?)$/i
    );

  const equivalent =
    equivalentTr ||
    equivalentEn ||
    equivalentRu;

  if (equivalent) {

    const amount =
      equivalent[1];

    return pick(
      `$${amount} karşılığı`,
      `$${amount} equivalent`,
      `эквивалент $${amount}`
    );
  }


  const paidTr =
    value.match(
      /^(\d+)\s+ücretli referral$/i
    );

  const paidEn =
    value.match(
      /^Paid referrals:\s*(\d+)$/i
    );

  const paidRu =
    value.match(
      /^Платные рефералы:\s*(\d+)$/i
    );

  const paid =
    paidTr ||
    paidEn ||
    paidRu;

  if (paid) {

    const n =
      Number(
        paid[1]
      );

    return pick(
      `${n} ücretli referral`,
      `Paid referrals: ${n}`,
      `Платные рефералы: ${n}`
    );
  }


  return null;
}

function translateCore(
  value: string,
  lang: UiLang,
): string {

  const normalized =
    normalize(
      value
    );


  if (!normalized) {
    return value;
  }


  return (
    exactTranslation(
      normalized,
      lang
    ) ||
    phase7d4DynamicTranslation(
      normalized,
      lang
    ) ||
    dynamicTranslation(
      normalized,
      lang
    ) ||
    value
  );
}


function translateTextNode(
  node: Text,
  lang: UiLang,
): void {

  const parent =
    node.parentElement;


  if (!parent) {
    return;
  }


  if (
    parent.closest(
      'script,style,noscript,code,pre'
    )
  ) {

    return;
  }


  const raw =
    node.nodeValue ||
    '';


  if (!raw.trim()) {
    return;
  }


  const leading =
    raw.match(
      /^\s*/
    )?.[0] ||
    '';


  const trailing =
    raw.match(
      /\s*$/
    )?.[0] ||
    '';


  /*
   * PHASE_7D2_WHITESPACE_LOOP_FIX_20260816
   *
   * translateCore() must receive only the visible
   * text payload. Otherwise an untranslated node
   * returns its original outer whitespace and the
   * leading/trailing whitespace below gets added
   * a second time. MutationObserver would then
   * repeatedly mutate the same node.
   *
   * Internal whitespace such as ru-RU NBSP remains
   * untouched.
   */
  const coreEnd =
    raw.length -
    trailing.length;


  const core =
    raw.slice(
      leading.length,
      coreEnd
    );


  const translated =
    translateCore(
      core,
      lang
    );


  const next =
    leading +
    translated +
    trailing;


  if (
    next !==
    raw
  ) {

    node.nodeValue =
      next;
  }
}


function translateAttributes(
  element: Element,
  lang: UiLang,
): void {

  for (
    const attribute
    of [
      'placeholder',
      'title',
      'aria-label',
    ]
  ) {

    const current =
      element.getAttribute(
        attribute
      );


    if (!current) {
      continue;
    }


    const translated =
      translateCore(
        current,
        lang
      );


    if (
      translated !==
      current
    ) {

      element.setAttribute(
        attribute,
        translated
      );
    }
  }
}


export function translateTree(
  root:
    ParentNode =
      document,
  lang:
    UiLang =
      getUiLanguage(),
): void {

  if (
    root instanceof Element
  ) {

    translateAttributes(
      root,
      lang
    );
  }


  const elements =
    root.querySelectorAll?.(
      '*'
    );


  elements?.forEach(
    element => {

      translateAttributes(
        element,
        lang
      );
    }
  );


  const walker =
    document.createTreeWalker(
      root,
      NodeFilter.SHOW_TEXT
    );


  let node =
    walker.nextNode();


  while (node) {

    translateTextNode(
      node as Text,
      lang
    );


    node =
      walker.nextNode();
  }
}


let started =
  false;


let observer:
  MutationObserver | null =
    null;



/*
 * PHASE_7E_DOCUMENT_TITLE_I18N_20260816
 *
 * Router titles use the Turkish canonical route label.
 * Translate only the route-label prefix and preserve
 * " — Acki Nacki Radar".
 *
 * A dedicated observer is required because <title>
 * lives in <head>, outside the normal body translator.
 */
let documentTitleI18nInstalled =
  false;


function translateDocumentTitle(
  lang: UiLang,
): void {

  const current =
    document.title;

  if (!current) {
    return;
  }


  const separator =
    ' — ';

  const separatorIndex =
    current.indexOf(
      separator
    );


  if (
    separatorIndex <
    0
  ) {

    const translated =
      translateCore(
        current,
        lang
      );

    if (
      translated !==
      current
    ) {

      document.title =
        translated;
    }

    return;
  }


  const routeTitle =
    current.slice(
      0,
      separatorIndex
    );

  const suffix =
    current.slice(
      separatorIndex
    );


  const translatedRouteTitle =
    translateCore(
      routeTitle,
      lang
    );


  const next =
    translatedRouteTitle +
    suffix;


  if (
    next !==
    current
  ) {

    document.title =
      next;
  }
}


function installDocumentTitleI18n():
  void {

  if (
    documentTitleI18nInstalled
  ) {

    return;
  }


  documentTitleI18nInstalled =
    true;


  const apply =
    () => {

      translateDocumentTitle(
        getUiLanguage()
      );
    };


  /*
   * Initial direct route load.
   */
  apply();


  /*
   * Instant TR / EN / RU switch.
   */
  window.addEventListener(
    'radar:language',
    apply
  );


  /*
   * Router may write a new Turkish canonical
   * title after runtime startup. Translate it
   * immediately without a reload.
   */
  const title =
    document.querySelector(
      'title'
    );


  if (title) {

    const observer =
      new MutationObserver(
        apply
      );


    observer.observe(
      title,
      {
        childList:
          true,

        characterData:
          true,

        subtree:
          true,
      }
    );
  }
}


export function startI18nRuntime():
  void {

  installDocumentTitleI18n();

  if (started) {

    translateTree(
      document,
      getUiLanguage()
    );

    return;
  }


  started =
    true;


  let current =
    getUiLanguage();


  document.documentElement.lang =
    current;


  const apply =
    (
      lang:
        UiLang
    ) => {

      current =
        lang;


      document.documentElement.lang =
        lang;


      window.localStorage.setItem(
        LANGUAGE_KEY,
        lang
      );


      translateTree(
        document,
        lang
      );
    };


  window.addEventListener(
    'radar:language',
    event => {

      const detail =
        (
          event as
            CustomEvent<{
              lang?: string;
            }>
        ).detail;


      const next =
        detail?.lang;


      if (
        next === 'tr' ||
        next === 'en' ||
        next === 'ru'
      ) {

        apply(
          next
        );
      }
    }
  );


  observer =
    new MutationObserver(
      mutations => {

        for (
          const mutation
          of mutations
        ) {

          if (
            mutation.type ===
              'characterData' &&
            mutation.target instanceof
              Text
          ) {

            translateTextNode(
              mutation.target,
              current
            );

            continue;
          }


          mutation.addedNodes.forEach(
            node => {

              if (
                node instanceof Text
              ) {

                translateTextNode(
                  node,
                  current
                );

              } else if (
                node instanceof Element
              ) {

                translateTree(
                  node,
                  current
                );
              }
            }
          );
        }
      }
    );


  const target =
    document.body ||
    document.documentElement;


  observer.observe(
    target,
    {
      childList:
        true,

      subtree:
        true,

      characterData:
        true,
    }
  );


  queueMicrotask(
    () => {
      apply(
        current
      );
    }
  );
}
