import React, { Component } from 'react';
import PropTypes from 'prop-types';
import { throttle } from 'lodash';
import inlineScript from './inline-script.raw.js';

export default class AppPreloader extends Component {
    state = {
        renderScript: typeof window !== 'undefined' && !!window.__APP_PRELOADER__,
        progress: typeof window !== 'undefined' && window.__APP_PRELOADER__ ? window.__APP_PRELOADER__.progress : 0,
        error: undefined,
    };

    time = 0;
    timeoutId;
    promise;
    progressDecayFn;

    componentDidMount() {
        if (window.__APP_PRELOADER__) {
            clearTimeout(window.__APP_PRELOADER__.intervalId);
            delete window.__APP_PRELOADER__;
        }

        this.setStateThrottled = throttle(this.setState.bind(this), this.props.progressInterval, { leading: false });
        this.progressDecayFn = new Function(['time'], `return (${this.props.progressDecay})(time)`);

        this.trackPromise();
    }

    componentDidUpdate(prevProps, prevState) {
        if (prevProps.progressInterval !== this.props.progressInterval) {
            this.setStateThrottled = throttle(this.setState.bind(this), this.props.progressInterval, { leading: false });
        }
        if (prevProps.progressDecay !== this.props.progressDecay) {
            this.progressDecayFn = new Function(['time'], `return (${this.props.progressDecay})(time)`);
        }

        if (prevProps.promise !== this.props.promise) {
            this.untrackPromise();
            this.trackPromise();
        } else if (!prevState.error && this.state.error) {
            this.props.onDone && this.props.onDone(this.state.error);
        } else if (prevState.progress !== 1 && this.state.progress === 1) {
            this.props.onDone && this.props.onDone();
        }
    }

    componentWillUnmount() {
        this.untrackPromise();
    }

    render() {
        const { renderScript, progress, error } = this.state;
        const { progressDecay, progressInterval, applyProgressBeforeInteractive, maxProgressBeforeInteractive, children } = this.props;

        return (
            <>
                { renderScript && (
                    <script
                        dangerouslySetInnerHTML={ { __html: inlineScript } }
                        data-max-progress={ maxProgressBeforeInteractive }
                        data-apply-progress={ applyProgressBeforeInteractive && `(${applyProgressBeforeInteractive})(elements, progress)` }
                        data-progress-decay={ progressDecay && `return (${progressDecay})(time)` }
                        data-progress-interval={ progressInterval } />
                ) }
                { children({ progress, error }) }
            </>
        );
    }

    untrackPromise() {
        this.setStateThrottled.cancel();
        clearTimeout(this.timeoutId);

        this.time = 0;
        this.timeoutId = undefined;
        this.promise = undefined;
    }

    trackPromise() {
        this.promise = this.props.promise;

        const maybe = (fn) => (...args) => this.promise === this.props.promise && fn(...args);

        this.setStateThrottled({
            progress: this.props.maxProgressBeforeInteractive,
            error: undefined,
            renderScript: false,
        }, maybe(() => {
            if (!this.promise) {
                this.setStateThrottled({ progress: 1 });

                return;
            }

            if (!this.promise.onProgress) {
                this.startFakeProgress(maybe((progress) => {
                    this.setStateThrottled({ progress: this.normalizeProgress(progress) });
                }));
            } else {
                this.setStateThrottled({ progress: this.normalizeProgress(this.promise.progress) });
                this.promise.onProgress(maybe((progress) => {
                    this.setStateThrottled({ progress: this.normalizeProgress(progress) });
                }));
            }

            this.promise
                .then(maybe(() => {
                    this.untrackPromise();
                    this.setStateThrottled({ progress: 1 });
                }))
                .catch(maybe((err) => {
                    this.untrackPromise();
                    this.setStateThrottled({ error: err });
                }));
        }));
    }

    startFakeProgress = (fn) => {
        const { progressInterval } = this.props;

        this.time += progressInterval;

        fn(this.progressDecayFn(this.time));

        this.timeoutId = setTimeout(() => this.startFakeProgress(fn), progressInterval);
    };

    normalizeProgress(progress) {
        const { maxProgressBeforeInteractive } = this.props;

        // Normalize progress having into consideration the progress from before interactive and
        // round it to 6 decimal places to circumvent issues with using floats with large decimals places in styles´
        const truncatedProgress = Math.max(Math.min(progress, 1), 0);
        const normalizedProgress = maxProgressBeforeInteractive + ((1 - maxProgressBeforeInteractive) * truncatedProgress);
        const roundedProgress = Math.round(normalizedProgress * (10 ** 6)) / (10 ** 6);

        return roundedProgress;
    }
}

AppPreloader.propTypes = {
    children: PropTypes.func.isRequired,
    maxProgressBeforeInteractive: PropTypes.number,
    applyProgressBeforeInteractive: PropTypes.oneOfType([PropTypes.func, PropTypes.string]).isRequired,
    progressDecay: PropTypes.oneOfType([PropTypes.func, PropTypes.string]),
    progressInterval: PropTypes.number,
    promise: PropTypes.object,
    onDone: PropTypes.func,
};

AppPreloader.defaultProps = {
    progressInterval: 100,
    progressDecay: /* istanbul ignore next */ (time) => Math.min(1 - Math.exp(-1 * time / 4000), 0.95),
    maxProgressBeforeInteractive: 0.4,
};
