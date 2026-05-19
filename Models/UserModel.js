import mongoose from 'mongoose';

const UserSchema = mongoose.Schema(
    {
        fullName: {
            type: String,
            required: [true, 'Please add a full name'],
            trim: true,
        },

        email: {
            type: String,
            required: [true, 'Please add an email'],
            unique: true,
            trim: true,
            lowercase: true,
            index: true,
        },

        password: {
            type: String,
            required: [true, 'Please add a password'],
            minlength: [6, 'Password must be at least 6 characters'],
        },

        image: {
            type: String,
            default: '',
        },

        isAdmin: {
            type: Boolean,
            default: false,
            index: true,
        },

        likedMovies: [
            {
                type: mongoose.Schema.Types.ObjectId,
                ref: 'Movie',
            },
        ],

        /* ============================================================
           Email verification
           ============================================================ */
        emailVerified: {
            type: Boolean,
            default: false,
            index: true,
        },

        emailVerificationToken: {
            type: String,
            default: '',
            index: true,
        },

        emailVerificationTokenExpiresAt: {
            type: Date,
            default: null,
        },

        /* ============================================================
           Reward / referral system
           ============================================================ */
        referralCode: {
            type: String,
            unique: true,
            sparse: true,
            trim: true,
            uppercase: true,
            index: true,
        },

        referredBy: {
            type: mongoose.Schema.Types.ObjectId,
            ref: 'User',
            default: null,
            index: true,
        },

        registrationIp: {
            type: String,
            default: '',
            index: true,
        },

        registrationUserAgent: {
            type: String,
            default: '',
        },

        referralDeviceId: {
            type: String,
            default: '',
            index: true,
        },

        reward: {
            adFreeUntil: {
                type: Date,
                default: null,
                index: true,
            },

            rewardClaimedReferralCount: {
                type: Number,
                default: 0,
            },

            referredBonusGrantedAt: {
                type: Date,
                default: null,
            },
        },

        rewardActivity: {
            activeDays: {
                type: [String],
                default: [],
            },

            watchSeconds: {
                type: Number,
                default: 0,
            },

            watchedMovieIds: [
                {
                    type: mongoose.Schema.Types.ObjectId,
                    ref: 'Movie',
                },
            ],

            lastActivityAt: {
                type: Date,
                default: null,
            },
        },
    },
    {
        timestamps: true,
    }
);

UserSchema.index({ registrationIp: 1, createdAt: -1 });
UserSchema.index({ referralDeviceId: 1, createdAt: -1 });

export default mongoose.models.User || mongoose.model('User', UserSchema);
