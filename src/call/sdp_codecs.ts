export function hackH264Level(mline: any, log: (...args: any[]) => void) {
    if (mline.rtp) {
        mline.rtp.forEach(function(rtp: any) {
            if (rtp.codec === "H264" && mline.fmtp) {
                for (let k = 0; k < mline.fmtp.length; k++) {
                    let fmtp = mline.fmtp[k];
                    if (fmtp.payload === rtp.payload) {
                        let params = fmtp.config.split(";");
                        for (let i = 0; i < params.length; i++) {
                            if (params[i].startsWith("profile-level-id")) {
                                let profile = parseInt(params[i].split("=")[1].substr(0, 6), 16);
                                if (profile & 0x420000) {
                                    profile |= 0x004000;
                                    log("Hacked h264 profile level");
                                } else {
                                    throw "H.264 profile is not baseline";
                                }
                                params[i] = "profile-level-id=" + profile.toString(16);
                            }
                        }
                        fmtp.config = params.join(";");
                    }
                }
            }
        });
    }
}

let h264Params = [{ key: "max-fs", value: 8192 }, { key: "max-mbps", value: 245000 }, { key: "max-dpb", value: 32768 }];

export function hackH264Params(mline: any, log: (...args: any[]) => void) {
    if (mline.rtp) {
        mline.rtp.forEach(function(rtp: any) {
            if (rtp.codec === "H264" && mline.fmtp) {
                for (let k = 0; k < mline.fmtp.length; k++) {
                    let fmtp = mline.fmtp[k];
                    if (fmtp.payload === rtp.payload) {
                        let params = fmtp.config.split(";").map(function(param: string) {
                            let split = param.split("=");
                            return { key: split[0], value: split[1] };
                        });
                        h264Params.forEach(function(p) {
                            for (let i = 0; i < params.length; i++) {
                                if (params[i].key === p.key) {
                                    params[i].value = p.value;
                                    return;
                                }
                            }
                            params.push(p);
                        });
                        fmtp.config = params
                            .map(function(p: any) {
                                return p.key + "=" + p.value;
                            })
                            .join(";");
                        log("Hacked h264 fmtp ", fmtp);
                    }
                }
            }
        });
    }
}
