const express = require("express");
const path = require("path");

const app = express();

const PORT = process.env.PORT || 15100;

// تشغيل ملفات موقع TOP TRIP
app.use(express.static(__dirname));

// الصفحة الرئيسية
app.get("/", (req, res) => {
    res.sendFile(path.join(__dirname, "index.html"));
});

// تشغيل السيرفر على جميع الواجهات
app.listen(PORT, "0.0.0.0", () => {
    console.log(`TOP TRIP running on port ${PORT}`);
});