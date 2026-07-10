"use strict";


// ==================================================
// 法小萌配置
// ==================================================

// 填写新的 Coze PAT。
// 不要把 PAT 发到聊天、群聊或截图中。
const COZE_TOKEN = "pat_4waG0QShnbnYqfjiMQCpshgbpcLXcoe4AaNIZEYd8biPLx7UDXKFoOpiIpVPA8BI";


// 法小萌智能体 Bot ID
const COZE_BOT_ID = "7660461765197168676";


// Coze 对话接口
const COZE_CHAT_URL = "https://api.coze.cn/v3/chat";


// 张嘴和闭嘴图片
const CLOSED_IMAGE = "faxiang_close.png";
const OPEN_IMAGE = "faxiang_open.png";


/*
 * 跨手机语音识别后端地址。
 *
 * 下一步部署语音识别后端后，把地址填在这里，例如：
 *
 * const TRANSCRIBE_API_URL =
 *     "https://你的后端域名/api/transcribe";
 *
 * 现在先留空。
 */
const TRANSCRIBE_API_URL = "https://faxiaomeng-asr.511467750.workers.dev/transcribe";


// 是否在语音识别成功后自动发送问题
const AUTO_SEND_AFTER_VOICE = false;


// 最大录音时间，单位为毫秒
const MAX_RECORDING_TIME = 20000;


// ==================================================
// 页面状态
// ==================================================

let isRequesting = false;

let talkingTimer = null;

let lastAnswer = "";

let speechRunId = 0;

let voiceState = "idle";

let nativeRecognition = null;

let nativeRecognitionReceivedResult = false;

let nativeRecognitionTimer = null;

let mediaRecorder = null;

let microphoneStream = null;

let audioChunks = [];

let recordingTimer = null;


// 页面元素
const elements = {};


// ==================================================
// 初始化
// ==================================================

window.addEventListener(
    "DOMContentLoaded",
    initializeApp
);


function initializeApp() {

    elements.question =
        document.getElementById("question");

    elements.answerText =
        document.getElementById("answerText");

    elements.statusText =
        document.getElementById("statusText");

    elements.voiceHint =
        document.getElementById("voiceHint");

    elements.askButton =
        document.getElementById("askButton");

    elements.voiceButton =
        document.getElementById("voiceButton");

    elements.robotBox =
        document.getElementById("robotBox");

    elements.robotImg =
        document.getElementById("robotImg");

    elements.replayButton =
        document.getElementById("replayButton");

    elements.stopVoiceButton =
        document.getElementById("stopVoiceButton");


    const requiredElements = [
        "question",
        "answerText",
        "statusText",
        "askButton",
        "voiceButton",
        "robotBox",
        "robotImg",
        "replayButton",
        "stopVoiceButton"
    ];


    for (const elementName of requiredElements) {

        if (!elements[elementName]) {

            console.error(
                `页面缺少元素：${elementName}`
            );

            return;

        }

    }


    elements.robotImg.src =
        CLOSED_IMAGE;


    // 预加载张嘴图片，避免第一次切换时闪烁
    const openImagePreload =
        new Image();

    openImagePreload.src =
        OPEN_IMAGE;


    elements.askButton.addEventListener(
        "click",
        askFaxiang
    );


    elements.voiceButton.addEventListener(
        "click",
        handleVoiceButton
    );


    elements.replayButton.addEventListener(
        "click",
        () => {

            if (lastAnswer) {

                speakFaxiang(lastAnswer);

            }

        }
    );


    elements.stopVoiceButton.addEventListener(
        "click",
        stopSpeech
    );


    // Ctrl + Enter 快速提问
    elements.question.addEventListener(
        "keydown",
        (event) => {

            if (
                event.ctrlKey &&
                event.key === "Enter"
            ) {

                event.preventDefault();

                askFaxiang();

            }

        }
    );


    updateVoiceButton(
        "idle",
        "🎤 说出问题"
    );

}


// ==================================================
// 语音按钮
// ==================================================

async function handleVoiceButton() {

    if (isRequesting) {

        alert(
            "法小萌正在回答上一个问题，请稍等一下哦～"
        );

        return;

    }


    // 正在录音，再点一次停止
    if (voiceState === "recording") {

        stopMediaRecording();

        return;

    }


    // 正在使用浏览器语音识别，再点一次停止
    if (voiceState === "recognizing") {

        stopNativeRecognition();

        return;

    }


    // 正在上传识别时不重复操作
    if (voiceState === "transcribing") {

        return;

    }


    await startVoiceInput();

}


// ==================================================
// 启动语音输入
// ==================================================

async function startVoiceInput() {

    stopSpeech();


    /*
     * Chrome、部分安卓浏览器可使用原生语音识别。
     * iPhone、微信浏览器以及不兼容环境直接使用录音模式。
     */
    if (shouldTryNativeRecognition()) {

        startNativeRecognition();

        return;

    }


    await startMediaRecording();

}


// ==================================================
// 判断是否尝试浏览器原生语音识别
// ==================================================

function shouldTryNativeRecognition() {

    const RecognitionClass =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;


    if (!RecognitionClass) {

        return false;

    }


    const userAgent =
        navigator.userAgent || "";


    const isIOS =
        /iPhone|iPad|iPod/i.test(userAgent);


    const isWeChat =
        /MicroMessenger/i.test(userAgent);


    const isFirefox =
        /Firefox/i.test(userAgent);


    // 这些环境不优先使用 SpeechRecognition
    if (
        isIOS ||
        isWeChat ||
        isFirefox
    ) {

        return false;

    }


    return true;

}


// ==================================================
// 浏览器原生语音识别
// ==================================================

function startNativeRecognition() {

    const RecognitionClass =
        window.SpeechRecognition ||
        window.webkitSpeechRecognition;


    if (!RecognitionClass) {

        startMediaRecording();

        return;

    }


    cleanupNativeRecognition();


    nativeRecognition =
        new RecognitionClass();


    nativeRecognition.lang =
        "zh-CN";


    nativeRecognition.continuous =
        false;


    nativeRecognition.interimResults =
        true;


    nativeRecognition.maxAlternatives =
        1;


    nativeRecognitionReceivedResult =
        false;


    updateVoiceButton(
        "recognizing",
        "🟢 正在听，请说话…"
    );


    elements.voiceHint.textContent =
        "正在听你说话，说完后请稍等一下。";


    elements.statusText.textContent =
        "法小萌正在认真听 🎤";


    nativeRecognition.onresult =
        handleNativeRecognitionResult;


    nativeRecognition.onerror =
        handleNativeRecognitionError;


    nativeRecognition.onend =
        handleNativeRecognitionEnd;


    try {

        nativeRecognition.start();

    } catch (error) {

        console.warn(
            "浏览器语音识别启动失败：",
            error
        );


        cleanupNativeRecognition();


        startMediaRecording();

        return;

    }


    /*
     * 有些手机会显示正在识别，
     * 但一直不返回任何结果。
     * 8秒后自动切换到真实录音模式。
     */
    nativeRecognitionTimer =
        window.setTimeout(
            () => {

                if (
                    voiceState === "recognizing" &&
                    !nativeRecognitionReceivedResult
                ) {

                    console.warn(
                        "原生语音识别没有返回结果，切换录音模式。"
                    );


                    stopNativeRecognition(
                        true
                    );

                }

            },
            8000
        );

}


function handleNativeRecognitionResult(event) {

    let finalText = "";

    let interimText = "";


    for (
        let index = event.resultIndex;
        index < event.results.length;
        index += 1
    ) {

        const transcript =
            event.results[index][0].transcript;


        if (event.results[index].isFinal) {

            finalText +=
                transcript;

        } else {

            interimText +=
                transcript;

        }

    }


    const visibleText =
        (finalText || interimText).trim();


    if (visibleText) {

        nativeRecognitionReceivedResult =
            true;


        elements.question.value =
            visibleText;


        elements.voiceHint.textContent =
            `我听到的是：“${visibleText}”`;

    }


    if (finalText.trim()) {

        finishVoiceRecognition(
            finalText.trim()
        );

    }

}


function handleNativeRecognitionError(event) {

    console.warn(
        "浏览器语音识别错误：",
        event.error
    );


    const errorType =
        event.error || "";


    // 用户拒绝权限时不继续弹第二次权限
    if (
        errorType === "not-allowed" ||
        errorType === "service-not-allowed"
    ) {

        cleanupNativeRecognition();


        updateVoiceButton(
            "idle",
            "🎤 说出问题"
        );


        elements.statusText.textContent =
            "没有获得麦克风权限";


        elements.voiceHint.textContent =
            "请在浏览器设置中允许麦克风权限。";


        return;

    }


    /*
     * no-speech、network、aborted 等情况，
     * 自动切换为 MediaRecorder 录音模式。
     */
    if (!nativeRecognitionReceivedResult) {

        cleanupNativeRecognition();


        startMediaRecording();

    }

}


function handleNativeRecognitionEnd() {

    if (
        voiceState !== "recognizing"
    ) {

        return;

    }


    if (
        nativeRecognitionReceivedResult &&
        elements.question.value.trim()
    ) {

        finishVoiceRecognition(
            elements.question.value.trim()
        );

        return;

    }


    cleanupNativeRecognition();


    startMediaRecording();

}


function stopNativeRecognition(
    switchToRecorder = false
) {

    if (nativeRecognition) {

        nativeRecognition.onend =
            null;


        try {

            nativeRecognition.stop();

        } catch (error) {

            console.warn(
                "停止原生语音识别失败：",
                error
            );

        }

    }


    cleanupNativeRecognition();


    if (switchToRecorder) {

        startMediaRecording();

    } else {

        updateVoiceButton(
            "idle",
            "🎤 说出问题"
        );


        elements.statusText.textContent =
            "在线陪伴中 🤖";


        elements.voiceHint.textContent =
            "已停止语音输入。";

    }

}


function cleanupNativeRecognition() {

    if (nativeRecognitionTimer !== null) {

        window.clearTimeout(
            nativeRecognitionTimer
        );


        nativeRecognitionTimer =
            null;

    }


    if (nativeRecognition) {

        nativeRecognition.onresult =
            null;

        nativeRecognition.onerror =
            null;

        nativeRecognition.onend =
            null;

    }


    nativeRecognition =
        null;

}


// ==================================================
// MediaRecorder 手机录音
// ==================================================

async function startMediaRecording() {

    cleanupNativeRecognition();


    if (
        !navigator.mediaDevices ||
        !navigator.mediaDevices.getUserMedia
    ) {

        showVoiceError(
            "当前浏览器不支持打开麦克风，请换用系统浏览器或 Chrome。"
        );

        return;

    }


    if (!window.MediaRecorder) {

        showVoiceError(
            "当前浏览器不支持网页录音，请换一个浏览器再试。"
        );

        return;

    }


    try {

        microphoneStream =
            await navigator.mediaDevices.getUserMedia(
                {
                    audio: {
                        echoCancellation: true,
                        noiseSuppression: true,
                        autoGainControl: true,
                        channelCount: 1
                    }
                }
            );


        const mimeType =
            chooseRecordingMimeType();


        if (mimeType) {

            mediaRecorder =
                new MediaRecorder(
                    microphoneStream,
                    {
                        mimeType
                    }
                );

        } else {

            mediaRecorder =
                new MediaRecorder(
                    microphoneStream
                );

        }


        audioChunks = [];


        mediaRecorder.addEventListener(
            "dataavailable",
            (event) => {

                if (
                    event.data &&
                    event.data.size > 0
                ) {

                    audioChunks.push(
                        event.data
                    );

                }

            }
        );


        mediaRecorder.addEventListener(
            "stop",
            handleMediaRecordingStop,
            {
                once: true
            }
        );


        mediaRecorder.addEventListener(
            "error",
            (event) => {

                console.error(
                    "录音器错误：",
                    event.error
                );


                cleanupMediaRecorder();


                showVoiceError(
                    "录音出现问题，请重新试一次。"
                );

            }
        );


        mediaRecorder.start(
            250
        );


        updateVoiceButton(
            "recording",
            "⏹ 点这里结束录音"
        );


        elements.statusText.textContent =
            "法小萌正在听你说话 🎤";


        elements.voiceHint.textContent =
            "正在录音，说完后请点击“结束录音”。";


        recordingTimer =
            window.setTimeout(
                () => {

                    if (
                        voiceState === "recording"
                    ) {

                        stopMediaRecording();

                    }

                },
                MAX_RECORDING_TIME
            );

    } catch (error) {

        console.error(
            "无法访问麦克风：",
            error
        );


        cleanupMediaRecorder();


        if (
            error.name === "NotAllowedError" ||
            error.name === "PermissionDeniedError"
        ) {

            showVoiceError(
                "麦克风权限没有开启，请在浏览器设置中允许使用麦克风。"
            );

        } else if (
            error.name === "NotFoundError"
        ) {

            showVoiceError(
                "没有找到可以使用的麦克风。"
            );

        } else {

            showVoiceError(
                "无法打开麦克风，请关闭其他正在录音的应用后再试。"
            );

        }

    }

}


// ==================================================
// 选择浏览器支持的录音格式
// ==================================================

function chooseRecordingMimeType() {

    const candidates = [
        "audio/webm;codecs=opus",
        "audio/webm",
        "audio/mp4",
        "audio/ogg;codecs=opus",
        "audio/ogg"
    ];


    for (const mimeType of candidates) {

        if (
            MediaRecorder.isTypeSupported(
                mimeType
            )
        ) {

            return mimeType;

        }

    }


    return "";

}


// ==================================================
// 停止录音
// ==================================================

function stopMediaRecording() {

    if (
        !mediaRecorder ||
        mediaRecorder.state === "inactive"
    ) {

        cleanupMediaRecorder();


        updateVoiceButton(
            "idle",
            "🎤 说出问题"
        );


        return;

    }


    elements.statusText.textContent =
        "录音完成，正在识别文字…";


    elements.voiceHint.textContent =
        "请稍等，法小萌正在听写。";


    updateVoiceButton(
        "transcribing",
        "⏳ 正在识别…"
    );


    try {

        mediaRecorder.stop();

    } catch (error) {

        console.error(
            "停止录音失败：",
            error
        );


        cleanupMediaRecorder();


        showVoiceError(
            "停止录音时出现问题，请重新试一次。"
        );

    }

}


// ==================================================
// 录音停止后的处理
// ==================================================

async function handleMediaRecordingStop() {

    const recordedMimeType =
        mediaRecorder?.mimeType ||
        "audio/webm";


    const audioBlob =
        new Blob(
            audioChunks,
            {
                type: recordedMimeType
            }
        );


    cleanupMediaRecorder();


    if (audioBlob.size < 1000) {

        showVoiceError(
            "没有录到清楚的声音，请靠近麦克风再说一次。"
        );

        return;

    }


    await transcribeRecordedAudio(
        audioBlob
    );

}


// ==================================================
// 上传音频并识别文字
// ==================================================

async function transcribeRecordedAudio(
    audioBlob
) {

    /*
     * GitHub Pages 只有静态网页，
     * 不能安全保存语音识别服务的密钥。
     *
     * 所以需要下一步部署语音识别后端，
     * 然后在 TRANSCRIBE_API_URL 中填写地址。
     */
    if (!TRANSCRIBE_API_URL) {

        updateVoiceButton(
            "idle",
            "🎤 说出问题"
        );


        elements.statusText.textContent =
            "手机录音功能测试成功 ✅";


        elements.voiceHint.textContent =
            "录音已经成功。下一步接入语音识别后端，就能自动转换成文字。";


        alert(
            "手机录音已经成功！\n\n下一步需要接入语音识别后端，才能把这段录音转换成文字。"
        );


        return;

    }


    updateVoiceButton(
        "transcribing",
        "⏳ 正在识别…"
    );


    elements.statusText.textContent =
        "正在把语音转换成文字…";


    try {

        const fileName =
            createAudioFileName(
                audioBlob.type
            );


        const formData =
            new FormData();


        formData.append(
            "audio",
            audioBlob,
            fileName
        );


        formData.append(
            "language",
            "zh-CN"
        );


        const response =
            await fetch(
                TRANSCRIBE_API_URL,
                {
                    method: "POST",
                    body: formData
                }
            );


        const responseText =
            await response.text();


        let result;


        try {

            result =
                JSON.parse(responseText);

        } catch (error) {

            throw new Error(
                "语音识别服务器返回的内容格式不正确。"
            );

        }


        if (!response.ok) {

            throw new Error(
                result.message ||
                result.error ||
                `语音识别失败，状态码 ${response.status}`
            );

        }


        const recognizedText =
            String(
                result.text ||
                result.transcript ||
                ""
            ).trim();


        if (!recognizedText) {

            throw new Error(
                "没有识别到清楚的文字，请重新说一次。"
            );

        }


        finishVoiceRecognition(
            recognizedText
        );

    } catch (error) {

        console.error(
            "语音转文字失败：",
            error
        );


        showVoiceError(
            `语音识别失败：${error.message}`
        );

    }

}


// ==================================================
// 根据录音格式生成文件名
// ==================================================

function createAudioFileName(
    mimeType
) {

    if (
        mimeType.includes("mp4")
    ) {

        return "voice-input.m4a";

    }


    if (
        mimeType.includes("ogg")
    ) {

        return "voice-input.ogg";

    }


    return "voice-input.webm";

}


// ==================================================
// 语音识别成功
// ==================================================

function finishVoiceRecognition(
    recognizedText
) {

    cleanupNativeRecognition();


    updateVoiceButton(
        "idle",
        "🎤 重新说一次"
    );


    elements.question.value =
        recognizedText;


    elements.statusText.textContent =
        "已经听清楚啦，可以发送问题了 ✅";


    elements.voiceHint.textContent =
        `识别结果：“${recognizedText}”`;


    elements.question.focus();


    if (AUTO_SEND_AFTER_VOICE) {

        askFaxiang();

    }

}


// ==================================================
// 语音输入错误
// ==================================================

function showVoiceError(
    message
) {

    updateVoiceButton(
        "idle",
        "🎤 重新说一次"
    );


    elements.statusText.textContent =
        "语音输入遇到问题";


    elements.voiceHint.textContent =
        message;


    alert(message);

}


// ==================================================
// 更新麦克风按钮
// ==================================================

function updateVoiceButton(
    state,
    text
) {

    voiceState =
        state;


    elements.voiceButton.classList.remove(
        "recording",
        "listening"
    );


    elements.voiceButton.disabled =
        state === "transcribing";


    if (state === "recording") {

        elements.voiceButton.classList.add(
            "recording"
        );

    }


    if (state === "recognizing") {

        elements.voiceButton.classList.add(
            "listening"
        );

    }


    elements.voiceButton.textContent =
        text;

}


// ==================================================
// 清理录音资源
// ==================================================

function cleanupMediaRecorder() {

    if (recordingTimer !== null) {

        window.clearTimeout(
            recordingTimer
        );


        recordingTimer =
            null;

    }


    if (microphoneStream) {

        for (
            const track of microphoneStream.getTracks()
        ) {

            track.stop();

        }

    }


    microphoneStream =
        null;

    mediaRecorder =
        null;

    audioChunks =
        [];

}


// ==================================================
// 向 Coze 提问
// ==================================================

async function askFaxiang() {

    if (isRequesting) {

        return;

    }


    if (
        voiceState === "recording" ||
        voiceState === "recognizing" ||
        voiceState === "transcribing"
    ) {

        alert(
            "请先完成语音输入，再向法小萌提问哦～"
        );

        return;

    }


    const question =
        elements.question.value.trim();


    if (!question) {

        alert(
            "小朋友，请先输入或说出问题哦～"
        );


        elements.question.focus();

        return;

    }


    if (
        !COZE_TOKEN.startsWith("pat_") ||
        COZE_TOKEN.includes("请替换")
    ) {

        elements.answerText.textContent =
            "请打开 script.js，在顶部填写新的 Coze PAT 令牌。";

        return;

    }


    stopSpeech();


    setRequestingState(
        true
    );


    setRobotState(
        "thinking"
    );


    elements.answerText.textContent =
        "法小萌正在思考中 🤔";


    elements.statusText.textContent =
        "正在认真查找答案…";


    let sseBuffer =
        "";


    let streamedAnswer =
        "";


    let completedAnswer =
        "";


    function handleSseBlock(
        block
    ) {

        const lines =
            block.split(/\r?\n/);


        let eventName =
            "";


        const dataLines =
            [];


        for (const line of lines) {

            if (
                line.startsWith("event:")
            ) {

                eventName =
                    line.slice(6).trim();

            } else if (
                line.startsWith("data:")
            ) {

                dataLines.push(
                    line.slice(5).trim()
                );

            }

        }


        if (
            dataLines.length === 0
        ) {

            return;

        }


        const rawData =
            dataLines.join("\n");


        if (
            eventName === "done" ||
            rawData === "[DONE]" ||
            rawData === "\"[DONE]\""
        ) {

            return;

        }


        let message;


        try {

            message =
                JSON.parse(rawData);

        } catch (error) {

            console.warn(
                "跳过无法解析的 Coze 数据：",
                rawData
            );

            return;

        }


        console.log(
            "Coze事件：",
            eventName,
            message
        );


        // 实时增量文字
        if (
            eventName ===
                "conversation.message.delta" &&

            message.role === "assistant" &&

            message.type === "answer" &&

            typeof message.content === "string"
        ) {

            streamedAnswer +=
                message.content;


            if (
                streamedAnswer.trim()
            ) {

                elements.answerText.textContent =
                    streamedAnswer;

            }

        }


        // 最终完整回答
        if (
            eventName ===
                "conversation.message.completed" &&

            message.role === "assistant" &&

            message.type === "answer" &&

            typeof message.content === "string" &&

            message.content.trim()
        ) {

            completedAnswer =
                message.content.trim();


            elements.answerText.textContent =
                completedAnswer;

        }


        // Coze 返回失败
        if (
            eventName ===
                "conversation.chat.failed" ||

            eventName === "error"
        ) {

            const errorMessage =
                message.msg ||
                message.last_error?.msg ||
                "Coze 返回了未知错误";


            throw new Error(
                errorMessage
            );

        }

    }


    try {

        const response =
            await fetch(
                COZE_CHAT_URL,
                {
                    method: "POST",

                    headers: {
                        Authorization:
                            `Bearer ${COZE_TOKEN}`,

                        "Content-Type":
                            "application/json"
                    },

                    body: JSON.stringify({
                        bot_id:
                            COZE_BOT_ID,

                        user_id:
                            "child_001",

                        stream:
                            true,

                        auto_save_history:
                            true,

                        additional_messages: [
                            {
                                role:
                                    "user",

                                content:
                                    question,

                                content_type:
                                    "text"
                            }
                        ]
                    })
                }
            );


        if (!response.ok) {

            const errorText =
                await response.text();


            throw new Error(
                `请求失败，状态码 ${response.status}：${errorText}`
            );

        }


        if (!response.body) {

            throw new Error(
                "浏览器没有收到 Coze 的流式响应。"
            );

        }


        const reader =
            response.body.getReader();


        const decoder =
            new TextDecoder("utf-8");


        while (true) {

            const {
                value,
                done
            } =
                await reader.read();


            if (done) {

                break;

            }


            sseBuffer +=
                decoder.decode(
                    value,
                    {
                        stream: true
                    }
                );


            const blocks =
                sseBuffer.split(
                    /\r?\n\r?\n/
                );


            sseBuffer =
                blocks.pop() || "";


            for (
                const block of blocks
            ) {

                if (
                    block.trim()
                ) {

                    handleSseBlock(
                        block
                    );

                }

            }

        }


        sseBuffer +=
            decoder.decode();


        if (
            sseBuffer.trim()
        ) {

            handleSseBlock(
                sseBuffer
            );

        }


        const finalAnswer =
            completedAnswer ||
            streamedAnswer.trim();


        if (!finalAnswer) {

            throw new Error(
                "法小萌没有收到有效回答，请再试一次哦～"
            );

        }


        lastAnswer =
            finalAnswer;


        elements.answerText.textContent =
            finalAnswer;


        elements.statusText.textContent =
            "回答完成，正在朗读…";


        elements.replayButton.disabled =
            false;


        setRobotState(
            "idle"
        );


        speakFaxiang(
            finalAnswer
        );

    } catch (error) {

        console.error(
            "法小萌请求失败：",
            error
        );


        setRobotState(
            "idle"
        );


        elements.answerText.textContent =
            `法小萌连接失败啦～\n${error.message}`;


        elements.statusText.textContent =
            "连接出现问题";

    } finally {

        setRequestingState(
            false
        );

    }

}


// ==================================================
// 法小萌语音朗读
// ==================================================

function speakFaxiang(
    text
) {

    const speechText =
        cleanTextForSpeech(
            text
        );


    if (!speechText) {

        return;

    }


    speechRunId +=
        1;


    const currentRunId =
        speechRunId;


    window.speechSynthesis.cancel();


    stopTalkingAnimation();


    const speech =
        new SpeechSynthesisUtterance(
            speechText
        );


    speech.lang =
        "zh-CN";


    speech.rate =
        0.9;


    speech.pitch =
        1.12;


    speech.volume =
        1;


    const chineseVoice =
        window.speechSynthesis
            .getVoices()
            .find(
                (voice) =>
                    /zh-CN|zh-Hans|Chinese/i
                        .test(voice.lang)
            );


    if (chineseVoice) {

        speech.voice =
            chineseVoice;

    }


    speech.onstart =
        () => {

            if (
                currentRunId !==
                speechRunId
            ) {

                return;

            }


            startTalkingAnimation();


            elements.statusText.textContent =
                "法小萌正在回答你 🔊";


            elements.stopVoiceButton.disabled =
                false;

        };


    speech.onend =
        () => {

            if (
                currentRunId ===
                speechRunId
            ) {

                finishSpeech();

            }

        };


    speech.onerror =
        () => {

            if (
                currentRunId ===
                speechRunId
            ) {

                finishSpeech();

            }

        };


    window.speechSynthesis.speak(
        speech
    );

}


// ==================================================
// 嘴巴动画
// ==================================================

function startTalkingAnimation() {

    stopTalkingAnimation();


    setRobotState(
        "talking"
    );


    let mouthOpen =
        false;


    talkingTimer =
        window.setInterval(
            () => {

                mouthOpen =
                    !mouthOpen;


                elements.robotImg.src =
                    mouthOpen
                        ? OPEN_IMAGE
                        : CLOSED_IMAGE;

            },
            180
        );

}


function stopTalkingAnimation() {

    if (
        talkingTimer !== null
    ) {

        window.clearInterval(
            talkingTimer
        );


        talkingTimer =
            null;

    }


    if (
        elements.robotImg
    ) {

        elements.robotImg.src =
            CLOSED_IMAGE;

    }


    if (
        elements.robotBox
    ) {

        elements.robotBox.classList.remove(
            "talking"
        );

    }

}


// ==================================================
// 停止和结束朗读
// ==================================================

function finishSpeech() {

    stopTalkingAnimation();


    setRobotState(
        "idle"
    );


    elements.statusText.textContent =
        "在线陪伴中 🤖";


    elements.stopVoiceButton.disabled =
        true;

}


function stopSpeech() {

    speechRunId +=
        1;


    window.speechSynthesis.cancel();


    finishSpeech();

}


// ==================================================
// 角色状态
// ==================================================

function setRobotState(
    state
) {

    elements.robotBox.classList.remove(
        "thinking",
        "talking"
    );


    if (
        state === "thinking"
    ) {

        elements.robotBox.classList.add(
            "thinking"
        );

    } else if (
        state === "talking"
    ) {

        elements.robotBox.classList.add(
            "talking"
        );

    }

}


// ==================================================
// 提问按钮状态
// ==================================================

function setRequestingState(
    isBusy
) {

    isRequesting =
        isBusy;


    elements.askButton.disabled =
        isBusy;


    elements.voiceButton.disabled =
        isBusy;


    elements.askButton.textContent =
        isBusy
            ? "法小萌思考中…"
            : "问问法小萌";

}


// ==================================================
// 清理朗读文本
// ==================================================

function cleanTextForSpeech(
    text
) {

    return text

        .replace(
            /\[([^\]]+)]\([^)]+\)/g,
            "$1"
        )

        .replace(
            /[\*#`_>]/g,
            ""
        )

        .replace(
            /\s+/g,
            " "
        )

        .trim();

}


// 兼容可能存在的 onclick
window.askFaxiang =
    askFaxiang;