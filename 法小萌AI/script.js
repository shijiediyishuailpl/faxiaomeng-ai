"use strict";


// ================================
// 只需要修改这里的 Coze 配置
// ================================

// 把新生成的 PAT 放在双引号里面
const COZE_TOKEN = "pat_4waG0QShnbnYqfjiMQCpshgbpcLXcoe4AaNIZEYd8biPLx7UDXKFoOpiIpVPA8BI";

// 法小萌智能体 Bot ID
const COZE_BOT_ID = "7660461765197168676";


// 两张角色图片必须和网页文件放在同一个文件夹
const CLOSED_IMAGE = "faxiang_close.png";
const OPEN_IMAGE = "faxiang_open.png";


// Coze 对话接口
const COZE_CHAT_URL = "https://api.coze.cn/v3/chat";


// 页面状态
let isRequesting = false;
let talkingTimer = null;
let lastAnswer = "";
let speechRunId = 0;


// 保存页面元素
const elements = {};


// 页面加载完成后绑定按钮
window.addEventListener("DOMContentLoaded", () => {

    const voiceButton =
document.getElementById("voiceButton");


if(
voiceButton &&
window.SpeechRecognition ||
window.webkitSpeechRecognition
){


const SpeechRecognition =
window.SpeechRecognition ||
window.webkitSpeechRecognition;


const recognition =
new SpeechRecognition();


recognition.lang =
"zh-CN";


recognition.continuous =
false;


recognition.interimResults =
false;



voiceButton.onclick =
()=>{


voiceButton.innerText =
"🎤 正在听你说...";


recognition.start();


};



recognition.onresult =
(event)=>{


const text =
event.results[0][0].transcript;


elements.question.value =
text;


voiceButton.innerText =
"🎤 说出你的问题";


};



recognition.onerror =
()=>{


voiceButton.innerText =
"🎤 说出你的问题";


};



}

    elements.question =
        document.getElementById("question");

    elements.answerText =
        document.getElementById("answerText");

    elements.statusText =
        document.getElementById("statusText");

    elements.askButton =
        document.getElementById("askButton");

    elements.robotBox =
        document.getElementById("robotBox");

    elements.robotImg =
        document.getElementById("robotImg");

    elements.replayButton =
        document.getElementById("replayButton");

    elements.stopVoiceButton =
        document.getElementById("stopVoiceButton");


    // 默认显示闭嘴图
    elements.robotImg.src = CLOSED_IMAGE;


    // 点击提问
    elements.askButton.addEventListener(
        "click",
        askFaxiang
    );


    // 再听一次
    elements.replayButton.addEventListener(
        "click",
        () => {

            if (lastAnswer) {
                speakFaxiang(lastAnswer);
            }

        }
    );


    // 停止朗读
    elements.stopVoiceButton.addEventListener(
        "click",
        stopSpeech
    );


    // 输入框按 Ctrl + Enter 发送
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

});


// ================================
// 向法小萌提问
// ================================

async function askFaxiang() {

    // 防止连续点击发送多个请求
    if (isRequesting) {
        return;
    }


    const question =
        elements.question.value.trim();


    if (!question) {

        alert("小朋友，请先输入问题哦～");

        elements.question.focus();

        return;

    }


    // 检查令牌是否填写
    if (
        !COZE_TOKEN.startsWith("pat_") ||
        COZE_TOKEN.includes("请替换")
    ) {

        elements.answerText.textContent =
            "请先打开 script.js，在顶部填入新的 Coze PAT 令牌。";

        return;

    }


    // 停止上一段语音
    stopSpeech();


    // 进入思考状态
    setRequestingState(true);

    setRobotState("thinking");

    elements.answerText.textContent =
        "法小萌正在思考中 🤔";

    elements.statusText.textContent =
        "正在认真查找答案…";


    // 保存尚未解析完的流式内容
    let sseBuffer = "";

    // 保存增量回答
    let streamedAnswer = "";

    // 保存最终完整回答
    let completedAnswer = "";


    // 处理一整段 SSE 事件
    function handleSseBlock(block) {

        const lines =
            block.split(/\r?\n/);


        let eventName = "";

        const dataLines = [];


        for (const line of lines) {

            if (line.startsWith("event:")) {

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


        if (dataLines.length === 0) {
            return;
        }


        const rawData =
            dataLines.join("\n");


        // 数据流结束
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
            "Coze 事件：",
            eventName,
            message
        );


        /*
         * 增量回答。
         * Coze 一边生成，网页一边显示。
         */
        if (
            eventName ===
                "conversation.message.delta" &&

            message.role === "assistant" &&

            message.type === "answer" &&

            typeof message.content === "string"
        ) {

            streamedAnswer +=
                message.content;


            if (streamedAnswer.trim()) {

                elements.answerText.textContent =
                    streamedAnswer;

            }

        }


        /*
         * 最终完整回答。
         * 只读取 type 为 answer 的内容。
         * 自动忽略 verbose、follow_up 和工具调用信息。
         */
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


        // Coze明确返回失败
        if (
            eventName ===
                "conversation.chat.failed" ||

            eventName === "error"
        ) {

            const errorMessage =
                message.msg ||
                message.last_error?.msg ||
                "Coze 返回了未知错误";


            throw new Error(errorMessage);

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


        // HTTP请求失败
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


        // 持续读取 Coze 返回内容
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


            /*
             * SSE事件之间用空行分隔。
             * 最后一段可能不完整，
             * 保留到下一轮继续拼接。
             */
            const blocks =
                sseBuffer.split(
                    /\r?\n\r?\n/
                );


            sseBuffer =
                blocks.pop() || "";


            for (const block of blocks) {

                if (block.trim()) {

                    handleSseBlock(block);

                }

            }

        }


        // 获取解码器剩下的内容
        sseBuffer +=
            decoder.decode();


        if (sseBuffer.trim()) {

            handleSseBlock(sseBuffer);

        }


        // 优先使用最终完整回答
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


        setRobotState("idle");


        // 自动朗读，并启动嘴巴动画
        speakFaxiang(finalAnswer);

    } catch (error) {

        console.error(
            "法小萌请求失败：",
            error
        );


        setRobotState("idle");


        elements.answerText.textContent =

            `法小萌连接失败啦～\n${error.message}`;


        elements.statusText.textContent =
            "连接出现问题";

    } finally {

        setRequestingState(false);

    }

}


// ================================
// 语音朗读
// ================================

function speakFaxiang(text) {

    const speechText =
        cleanTextForSpeech(text);


    if (!speechText) {
        return;
    }


    speechRunId += 1;


    const currentRunId =
        speechRunId;


    // 停止上一次声音
    window.speechSynthesis.cancel();


    stopTalkingAnimation();


    const speech =
        new SpeechSynthesisUtterance(
            speechText
        );


    // 中文语音参数
    speech.lang =
        "zh-CN";

    speech.rate =
        0.9;

    speech.pitch =
        1.12;

    speech.volume =
        1;


    // 尽量选择中文语音
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


    // 开始朗读
    speech.onstart = () => {

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


    // 朗读结束
    speech.onend = () => {

        if (
            currentRunId ===
            speechRunId
        ) {

            finishSpeech();

        }

    };


    // 朗读出错
    speech.onerror = () => {

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


// ================================
// 嘴巴和身体动画
// ================================

function startTalkingAnimation() {

    stopTalkingAnimation();


    setRobotState("talking");


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

    if (talkingTimer !== null) {

        window.clearInterval(
            talkingTimer
        );


        talkingTimer =
            null;

    }


    if (elements.robotImg) {

        elements.robotImg.src =
            CLOSED_IMAGE;

    }


    if (elements.robotBox) {

        elements.robotBox.classList.remove(
            "talking"
        );

    }

}


// ================================
// 停止和结束语音
// ================================

function finishSpeech() {

    stopTalkingAnimation();


    setRobotState("idle");


    elements.statusText.textContent =
        "在线陪伴中 🤖";


    elements.stopVoiceButton.disabled =
        true;

}


function stopSpeech() {

    speechRunId += 1;


    window.speechSynthesis.cancel();


    finishSpeech();

}


// ================================
// 切换角色状态
// ================================

function setRobotState(state) {

    elements.robotBox.classList.remove(
        "thinking",
        "talking"
    );


    if (state === "thinking") {

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


// ================================
// 切换按钮状态
// ================================

function setRequestingState(isBusy) {

    isRequesting =
        isBusy;


    elements.askButton.disabled =
        isBusy;


    elements.askButton.textContent =

        isBusy

            ? "法小萌思考中…"

            : "问问法小萌";

}


// ================================
// 清理朗读文本中的 Markdown 符号
// ================================

function cleanTextForSpeech(text) {

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


// 兼容旧 HTML 中可能存在的 onclick
window.askFaxiang =
    askFaxiang;