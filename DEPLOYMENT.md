# Deployment ke Vercel

## Cara Deploy ke Vercel

### 1. Deploy via GitHub (Recommended)

1. **Push kode ke GitHub** (sudah dilakukan):
   ```bash
   git add .
   git commit -m "setup for vercel deployment"
   git push origin main
   ```

2. **Connect ke Vercel**:
   - Buka [vercel.com](https://vercel.com)
   - Login dengan GitHub
   - Klik "New Project"
   - Import repository `faruqeclypst/project-bk`
   - Pilih folder `frontend`

3. **Setup Environment Variables**:
   - Di Vercel Dashboard, masuk ke Project Settings
   - Pilih tab "Environment Variables"
   - Tambahkan:
     - **Name**: `VITE_PB_URL`
     - **Value**: `http://206.189.32.190:8090`
     - **Environment**: Production, Preview, Development

4. **Deploy**:
   - Klik "Deploy"
   - Vercel akan otomatis build dan deploy

### 2. Deploy via Vercel CLI

```bash
# Install Vercel CLI
npm i -g vercel

# Login ke Vercel
vercel login

# Deploy
vercel

# Set environment variable
vercel env add VITE_PB_URL
# Masukkan: http://206.189.32.190:8090

# Deploy ulang
vercel --prod
```

## Konfigurasi yang Sudah Disiapkan

✅ **vite.config.ts** - Sudah dikonfigurasi untuk environment variables
✅ **vercel.json** - Konfigurasi Vercel sudah dibuat
✅ **Environment Variables** - Siap untuk di-set di Vercel

## URL Aplikasi

Setelah deploy, aplikasi akan tersedia di:
- **Production**: `https://project-bk-xxx.vercel.app`
- **Preview**: `https://project-bk-git-main-faruqeclypst.vercel.app`

## Troubleshooting

### Jika Environment Variable tidak terbaca:
1. Pastikan `VITE_PB_URL` sudah di-set di Vercel Dashboard
2. Redeploy aplikasi setelah menambah environment variable
3. Cek di Vercel Function Logs jika ada error

### Jika PocketBase tidak bisa diakses:
1. Pastikan VPS PocketBase sudah running
2. Cek firewall VPS (port 8090 harus terbuka)
3. Test akses langsung ke http://206.189.32.190:8090/_/

## Next Steps

1. Deploy ke Vercel
2. Setup collections di PocketBase (lihat setup-collections.md)
3. Test aplikasi di URL Vercel
4. Setup domain custom (opsional)
