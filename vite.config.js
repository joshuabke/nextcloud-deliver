import { createAppConfig } from '@nextcloud/vite-config'

export default createAppConfig({
	main: 'src/main.js',
	sidebar: 'src/sidebar.js',
	public: 'src/public.js',
	publicfiles: 'src/publicfiles.js',
	admin: 'src/admin.js',
}, {
	inlineCSS: { relativeCSSInjection: true },
})
